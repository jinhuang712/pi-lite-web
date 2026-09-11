/**
 * The `fetch` tool: one URL in, a budgeted page body out.
 *
 * Both providers extract the page server-side and return markdown-ish text, so
 * this module needs no HTML parser and no runtime dependency. Free of Pi and
 * TypeBox imports so it stays unit-testable without the host.
 */

import { clampInt, firstNumber, firstString, type WebConfig } from "./config.ts";
import {
	callMcp,
	cleanBody,
	exaUrl,
	failover,
	type Fetcher,
	hostOf,
	normalizeUrl,
	PARALLEL_URL,
	parallelHeaders,
	type ProviderName,
	SESSION_ID,
	truncate,
} from "./mcp.ts";

/** Absolute ceiling for one fetched page, whatever the configuration says. */
export const HARD_MAX_FETCH_CHARS = 50_000;

export interface Page {
	title: string;
	url: string;
	text: string;
}

export interface FetchArguments {
	url: string;
	maxChars?: number;
}

export interface FetchOutcome {
	text: string;
	provider: ProviderName;
	chars: number;
	truncated: boolean;
}

/**
 * Normalizes sloppy tool arguments before schema validation: `link` / `href`
 * aliases, a bare string, a missing scheme, and count aliases.
 */
export function prepareFetchArguments(args: unknown): FetchArguments {
	if (typeof args === "string") return { url: normalizeInputUrl(args) };
	const input = (args ?? {}) as Record<string, unknown>;
	const url = normalizeInputUrl(firstString(input.url, input.link, input.href, input.uri, input.query));
	const count = firstNumber(input.maxChars, input.max_chars, input.maxCharacters, input.limit, input.length);
	const result: FetchArguments = { url };
	if (count !== undefined) result.maxChars = clampInt(count, 1, HARD_MAX_FETCH_CHARS);
	return result;
}

export async function fetchPage(
	url: string,
	maxChars: number,
	config: WebConfig,
	options: { signal?: AbortSignal; fetcher?: Fetcher } = {},
): Promise<FetchOutcome> {
	const fetcher = options.fetcher ?? fetch;
	const outcome = await failover<Page>({
		label: "fetch",
		providers: config.providers,
		timeoutMs: config.timeoutMs,
		signal: options.signal,
		async attempt(provider, signal) {
			const page =
				provider === "exa"
					? await fetchExa(fetcher, url, maxChars, signal, config.exaApiKey)
					: await fetchParallel(fetcher, url, signal, config.parallelApiKey);
			return page?.text ? page : undefined;
		},
	});
	if (outcome.value === undefined) {
		return { text: `Nothing readable at ${url}.`, provider: outcome.provider, chars: 0, truncated: false };
	}
	const rendered = formatPage(outcome.value, url, maxChars);
	return { ...rendered, provider: outcome.provider };
}

export async function fetchExa(fetcher: Fetcher, url: string, maxChars: number, signal: AbortSignal, apiKey?: string): Promise<Page | undefined> {
	// Ask the provider for a little more than the budget so a word-boundary cut still lands inside it.
	const text = await callMcp({
		fetcher,
		url: exaUrl(apiKey),
		tool: "web_fetch_exa",
		args: { urls: [url], maxCharacters: Math.min(HARD_MAX_FETCH_CHARS, maxChars + 200) },
		signal,
	});
	return text ? parseExaPage(text, url) : undefined;
}

export async function fetchParallel(fetcher: Fetcher, url: string, signal: AbortSignal, apiKey?: string): Promise<Page | undefined> {
	const text = await callMcp({
		fetcher,
		url: PARALLEL_URL,
		tool: "web_fetch",
		args: { urls: [url], full_content: true, session_id: SESSION_ID },
		headers: parallelHeaders(apiKey),
		signal,
	});
	return text ? parseParallelPage(text, url) : undefined;
}

/**
 * Exa returns `# Title`, a `URL:` line, then the body, which usually repeats the
 * title once as plain text and once as a heading. Keep the body only.
 */
export function parseExaPage(text: string, requestedUrl: string): Page | undefined {
	const lines = cleanBody(text).split("\n");
	let title = "";
	let url = "";
	let index = 0;
	for (; index < lines.length; index++) {
		const line = lines[index]!.trim();
		if (!title && line.startsWith("# ")) title = line.slice(2).trim();
		else if (/^URL:/i.test(line)) url = line.replace(/^URL:\s*/i, "").trim();
		else if (line !== "" && line !== title && line !== `# ${title}`) break;
	}
	const body = cleanBody(lines.slice(index).join("\n"));
	if (!title && !body) return undefined;
	return { title, url: normalizeUrl(url) || requestedUrl, text: body };
}

/** Parallel returns JSON with `results[].full_content` (or `excerpts`) and an `errors[]` list. */
export function parseParallelPage(text: string, requestedUrl: string): Page | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("{")) return { title: "", url: requestedUrl, text: cleanBody(trimmed) };
	let data: { results?: unknown; errors?: unknown };
	try {
		data = JSON.parse(trimmed);
	} catch {
		return { title: "", url: requestedUrl, text: cleanBody(trimmed) };
	}
	const first = Array.isArray(data.results) ? (data.results[0] as Record<string, unknown> | undefined) : undefined;
	if (!first) {
		const error = Array.isArray(data.errors) ? (data.errors[0] as { message?: unknown } | undefined) : undefined;
		if (typeof error?.message === "string") throw new Error(error.message.split("\n", 1)[0]!.slice(0, 300));
		return undefined;
	}
	const excerpts = Array.isArray(first.excerpts) ? first.excerpts.filter((v): v is string => typeof v === "string") : [];
	const body = typeof first.full_content === "string" && first.full_content.trim() ? first.full_content : excerpts.join("\n\n");
	return {
		title: typeof first.title === "string" ? first.title : "",
		url: normalizeUrl(typeof first.url === "string" ? first.url : "") || requestedUrl,
		text: cleanBody(body),
	};
}

/** `[Title](url)` on the first line, then the body cut to the budget, then a visible truncation mark. */
export function formatPage(page: Page, requestedUrl: string, maxChars: number): { text: string; chars: number; truncated: boolean } {
	const url = page.url || requestedUrl;
	const head = `[${page.title || hostOf(url) || url}](${url})`;
	const room = Math.max(0, maxChars - head.length - 2);
	const truncated = page.text.length > room;
	const body = truncate(page.text, room);
	const text = `${head}\n\n${body}${truncated ? `\n\n(truncated at ${maxChars} characters)` : ""}`;
	return { text, chars: page.text.length, truncated };
}

function normalizeInputUrl(raw: string): string {
	const trimmed = raw.trim().replace(/^<(.*)>$/, "$1");
	if (!trimmed) return "";
	return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}
