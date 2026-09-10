/**
 * Search provider adapters.
 *
 * Exa and Parallel both expose an MCP endpoint that answers one `tools/call`
 * JSON-RPC request over plain HTTP. That keeps this extension free of SDK
 * dependencies: one fetch, one parse, no API key required for a basic search.
 */

export const EXA_URL = "https://mcp.exa.ai/mcp";
export const PARALLEL_URL = "https://search.parallel.ai/mcp";

/** Refuse to buffer runaway responses from a misbehaving endpoint. */
export const MAX_BODY_CHARS = 2 * 1024 * 1024;

export type ProviderName = "exa" | "parallel";

export interface SearchResult {
	title: string;
	url: string;
	published?: string;
	text: string;
}

/** Subset of the global fetch signature so tests can inject a fake. */
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Stable per-process value; Parallel uses it for free-tier rate limiting. */
const SESSION_ID = globalThis.crypto.randomUUID();

export function exaUrl(apiKey?: string): string {
	if (!apiKey) return EXA_URL;
	const url = new URL(EXA_URL);
	url.searchParams.set("exaApiKey", apiKey);
	return url.toString();
}

/**
 * Read the text payload of a JSON-RPC response, tolerating both plain JSON and
 * SSE framing. Throws when the payload itself is an MCP error.
 */
export function readMcpText(body: string): string | undefined {
	const trimmed = body.trim();
	if (!trimmed) return undefined;
	const direct = readPayload(trimmed);
	if (direct !== undefined) return direct;
	for (const line of body.split("\n")) {
		const data = line.trim();
		if (!data.startsWith("data:")) continue;
		const found = readPayload(data.slice(5).trim());
		if (found !== undefined) return found;
	}
	return undefined;
}

function readPayload(payload: string): string | undefined {
	if (!payload.startsWith("{")) return undefined;
	let message: unknown;
	try {
		message = JSON.parse(payload);
	} catch {
		return undefined;
	}
	const envelope = message as { error?: { message?: unknown }; result?: { content?: unknown } };
	if (envelope.error) {
		const detail = typeof envelope.error.message === "string" ? envelope.error.message : "provider error";
		throw new Error(detail);
	}
	if (!Array.isArray(envelope.result?.content)) return undefined;
	for (const item of envelope.result.content) {
		const block = item as { type?: unknown; text?: unknown };
		if (typeof block?.text === "string" && block.text.trim()) return block.text;
	}
	return undefined;
}

async function callMcp(
	fetcher: Fetcher,
	url: string,
	tool: string,
	args: Record<string, unknown>,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<string | undefined> {
	const response = await fetcher(url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...headers,
		},
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
		signal,
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const body = await response.text();
	if (body.length > MAX_BODY_CHARS) throw new Error("response too large");
	return readMcpText(body);
}

export interface ProviderOptions {
	fetcher: Fetcher;
	query: string;
	numResults: number;
	signal: AbortSignal;
	apiKey?: string;
}

export async function searchExa(options: ProviderOptions): Promise<SearchResult[]> {
	const text = await callMcp(
		options.fetcher,
		exaUrl(options.apiKey),
		"web_search_exa",
		{ query: options.query, numResults: options.numResults },
		{},
		options.signal,
	);
	return text ? parseExaText(text, options.numResults) : [];
}

export async function searchParallel(options: ProviderOptions): Promise<SearchResult[]> {
	const text = await callMcp(
		options.fetcher,
		PARALLEL_URL,
		"web_search",
		{ objective: options.query, search_queries: [options.query], session_id: SESSION_ID },
		options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {},
		options.signal,
	);
	return text ? parseParallelText(text, options.numResults) : [];
}

const HEADER_LINE = /^([A-Za-z][A-Za-z ]{1,20}):[ \t]?(.*)$/;

/** Parses Exa's `Title: / URL: / Highlights:` text layout into results. */
export function parseExaText(text: string, limit = 10): SearchResult[] {
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
export function parseParallelText(text: string, limit = 10): SearchResult[] {
	const trimmed = text.trim();
	if (trimmed.startsWith("{")) {
		try {
			const data = JSON.parse(trimmed) as { results?: unknown };
			if (Array.isArray(data.results)) {
				const results: SearchResult[] = [];
				for (const item of data.results) {
					const raw = item as { title?: unknown; url?: unknown; publish_date?: unknown; excerpts?: unknown };
					const url = normalizeUrl(typeof raw.url === "string" ? raw.url : "");
					const excerpts = Array.isArray(raw.excerpts)
						? raw.excerpts.filter((value): value is string => typeof value === "string")
						: [];
					const result: SearchResult = {
						title: (typeof raw.title === "string" && raw.title) || hostOf(url),
						url,
						text: cleanBody(excerpts.join("\n\n")),
					};
					if (typeof raw.publish_date === "string") {
						const date = normalizeDate(raw.publish_date);
						if (date) result.published = date;
					}
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

/** Drops Exa's `...` chunk separators, trailing spaces, and blank-line runs. */
export function cleanBody(text: string): string {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	const kept: string[] = [];
	for (const line of lines) {
		const trimmedEnd = line.replace(/[ \t]+$/, "");
		const bare = trimmedEnd.trim();
		if (bare === "..." || bare === "…") continue;
		kept.push(trimmedEnd);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

function normalizeUrl(url: string): string {
	return /^https?:\/\//i.test(url) ? url : "";
}

function normalizeDate(value: string): string | undefined {
	const trimmed = value.trim();
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
	return match?.[1];
}
