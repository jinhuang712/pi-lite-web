/**
 * The `search` tool: one query in, a budgeted numbered list out.
 * Free of Pi and TypeBox imports so it stays unit-testable without the host.
 */

import { clampInt, firstNumber, firstString, HARD_MAX_RESULTS, type WebConfig } from "./config.ts";
import {
	callMcp,
	cleanBody,
	exaUrl,
	failover,
	type Fetcher,
	hostOf,
	normalizeDate,
	normalizeUrl,
	PARALLEL_URL,
	parallelHeaders,
	type ProviderName,
	SESSION_ID,
	truncate,
} from "./mcp.ts";

/** A sane query is short; refuse to forward a pasted document. */
export const MAX_QUERY_CHARS = 1000;

/** Below this an excerpt stops earning its tokens; skip the result instead. */
const MIN_EXCERPT = 160;

export interface SearchResult {
	title: string;
	url: string;
	published?: string;
	text: string;
}

export interface SearchArguments {
	query: string;
	numResults?: number;
}

export interface SearchOutcome {
	text: string;
	provider: ProviderName;
	resultCount: number;
}

/**
 * Normalizes sloppy tool arguments before schema validation: alias field names,
 * numeric strings, nested `{text}` objects, and out-of-range counts. Weaker
 * models are the reason this exists; a validation round trip costs more.
 */
export function prepareSearchArguments(args: unknown): SearchArguments {
	if (typeof args === "string") return { query: clampQuery(args) };
	const input = (args ?? {}) as Record<string, unknown>;
	const query = clampQuery(firstString(input.query, input.q, input.search_query, input.query_string, input.text));
	const count = firstNumber(input.numResults, input.num_results, input.maxResults, input.limit, input.count, input.n);
	const result: SearchArguments = { query };
	if (count !== undefined) result.numResults = clampInt(count, 1, HARD_MAX_RESULTS);
	return result;
}

export async function search(
	query: string,
	numResults: number,
	config: WebConfig,
	options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<SearchOutcome> {
	const fetcher = options.fetcher ?? fetch;
	const outcome = await failover<SearchResult[]>({
		label: "search",
		providers: config.providers,
		timeoutMs: config.timeoutMs,
		signal: options.signal,
		async attempt(provider, signal) {
			const results =
				provider === "exa"
					? await searchExa(fetcher, query, numResults, signal, config.exaApiKey)
					: await searchParallel(fetcher, query, numResults, signal, config.parallelApiKey);
			return results.length > 0 ? results : undefined;
		},
	});
	if (outcome.value === undefined) {
		return { text: `No search results found for "${query}". Try a different query.`, provider: outcome.provider, resultCount: 0 };
	}
	return {
		text: formatResults(outcome.value, config.search),
		provider: outcome.provider,
		resultCount: outcome.value.length,
	};
}

export async function searchExa(
	fetcher: Fetcher,
	query: string,
	numResults: number,
	signal: AbortSignal,
	apiKey?: string,
): Promise<SearchResult[]> {
	const text = await callMcp({ fetcher, url: exaUrl(apiKey), tool: "web_search_exa", args: { query, numResults }, signal });
	return text ? parseExaText(text, numResults) : [];
}

export async function searchParallel(
	fetcher: Fetcher,
	query: string,
	numResults: number,
	signal: AbortSignal,
	apiKey?: string,
): Promise<SearchResult[]> {
	const text = await callMcp({
		fetcher,
		url: PARALLEL_URL,
		tool: "web_search",
		args: { objective: query, search_queries: [query], session_id: SESSION_ID },
		headers: parallelHeaders(apiKey),
		signal,
	});
	return text ? parseParallelText(text, numResults) : [];
}

const HEADER_LINE = /^([A-Za-z][A-Za-z ]{1,20}):[ \t]?(.*)$/;

/** Parses Exa's `Title: / URL: / Highlights:` text layout into results. */
export function parseExaText(text: string, limit = HARD_MAX_RESULTS): SearchResult[] {
	const results: SearchResult[] = [];
	for (const block of text.split(/\n(?=Title:[ \t])/)) {
		const parsed = parseExaBlock(block);
		if (parsed) results.push(parsed);
		if (results.length >= limit) break;
	}
	return results;
}

function parseExaBlock(block: string): SearchResult | undefined {
	const lines = block.split(/\r?\n/);
	let title = "";
	let url = "";
	let published = "";
	let index = 0;
	for (; index < lines.length; index++) {
		const match = HEADER_LINE.exec(lines[index] ?? "");
		if (!match) break;
		const key = match[1]!.toLowerCase();
		const value = match[2]!.trim();
		if (key === "title") title = value;
		else if (key === "url") url = value;
		else if (key === "published") published = value;
		if (key === "highlights") {
			index++;
			break;
		}
	}
	if (!title && !url) return undefined;
	const result: SearchResult = { title: title || hostOf(url), url: normalizeUrl(url), text: cleanBody(lines.slice(index).join("\n")) };
	const date = normalizeDate(published);
	if (date) result.published = date;
	return result;
}

/** Parses Parallel's JSON payload; falls back to the text layout on shape drift. */
export function parseParallelText(text: string, limit = HARD_MAX_RESULTS): SearchResult[] {
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		try {
			const data = JSON.parse(trimmed) as { results?: unknown };
			if (Array.isArray(data.results)) {
				const results: SearchResult[] = [];
				for (const item of data.results) {
					const raw = item as { title?: unknown; url?: unknown; publish_date?: unknown; excerpts?: unknown };
					const url = normalizeUrl(typeof raw.url === "string" ? raw.url : "");
					const excerpts = Array.isArray(raw.excerpts) ? raw.excerpts.filter((v): v is string => typeof v === "string") : [];
					const result: SearchResult = {
						title: (typeof raw.title === "string" && raw.title) || hostOf(url),
						url,
						text: cleanBody(excerpts.join("\n\n")),
					};
					const date = normalizeDate(typeof raw.publish_date === "string" ? raw.publish_date : undefined);
					if (date) result.published = date;
					if (result.title || result.url || result.text) results.push(result);
					if (results.length >= limit) break;
				}
				return results;
			}
		} catch {
			// Fall through to the text layout.
		}
	}
	return parseExaText(text, limit);
}

/**
 * Renders a compact numbered list under an explicit character budget: title,
 * link, optional date, truncated excerpt. Stops when the remaining budget cannot
 * fit another useful excerpt and says how many results were left out.
 */
export function formatResults(results: SearchResult[], budget: { maxChars: number; perResultChars: number }): string {
	if (results.length === 0) return "";
	const blocks: string[] = [];
	let used = 0;

	for (const result of results) {
		const label = result.title || hostOf(result.url) || "result";
		const link = result.url ? `[${label}](${result.url})` : label;
		const head = `${blocks.length + 1}. ${link}${result.published ? ` (${result.published})` : ""}`;
		const room = budget.maxChars - used - head.length - 2;
		if (blocks.length > 0 && room < MIN_EXCERPT) break;

		const excerpt = truncate(result.text, Math.max(MIN_EXCERPT, Math.min(budget.perResultChars, room)));
		const block = excerpt ? `${head}\n${excerpt}` : head;
		blocks.push(block);
		used += block.length + 2;
	}

	const omitted = results.length - blocks.length;
	const suffix = omitted > 0 ? `\n\n(+${omitted} more result${omitted === 1 ? "" : "s"} omitted)` : "";
	return blocks.join("\n\n") + suffix;
}

function clampQuery(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}
