/**
 * MCP-over-HTTP transport and provider failover.
 *
 * Exa and Parallel both answer one `tools/call` JSON-RPC POST over plain HTTP,
 * without a session handshake. That is the whole transport: one fetch, one
 * parse, no SDK, no API key required.
 */

export const EXA_URL = "https://mcp.exa.ai/mcp";
export const PARALLEL_URL = "https://search.parallel.ai/mcp";

/** Refuse to buffer runaway responses from a misbehaving endpoint. */
export const MAX_BODY_CHARS = 2 * 1024 * 1024;

export type ProviderName = "exa" | "parallel";

/** Subset of the global fetch signature so tests can inject a fake. */
export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

/** Stable per-process value; Parallel uses it for free-tier rate limiting. */
export const SESSION_ID = globalThis.crypto.randomUUID();

export interface McpCall {
	fetcher: Fetcher;
	url: string;
	tool: string;
	args: Record<string, unknown>;
	headers?: Record<string, string>;
	signal: AbortSignal;
}

export function exaUrl(apiKey?: string): string {
	if (!apiKey) return EXA_URL;
	const url = new URL(EXA_URL);
	url.searchParams.set("exaApiKey", apiKey);
	return url.toString();
}

export function parallelHeaders(apiKey?: string): Record<string, string> {
	return apiKey ? { authorization: `Bearer ${apiKey}` } : {};
}

/** One JSON-RPC `tools/call`; resolves to the first text block, or undefined when there is none. */
export async function callMcp(call: McpCall): Promise<string | undefined> {
	const response = await call.fetcher(call.url, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			accept: "application/json, text/event-stream",
			...call.headers,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: call.tool, arguments: call.args },
		}),
		signal: call.signal,
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const body = await response.text();
	if (body.length > MAX_BODY_CHARS) throw new Error("response too large");
	return readMcpText(body);
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
	const envelope = message as {
		error?: { message?: unknown };
		result?: { content?: unknown; isError?: unknown };
	};
	if (envelope.error) {
		const detail = typeof envelope.error.message === "string" ? envelope.error.message : "provider error";
		throw new Error(firstLine(detail));
	}
	if (!Array.isArray(envelope.result?.content)) {
		if (envelope.result?.isError === true) throw new Error("provider returned an error");
		return undefined;
	}
	let text: string | undefined;
	for (const item of envelope.result.content) {
		const block = item as { type?: unknown; text?: unknown };
		if (typeof block?.text === "string" && block.text.trim()) {
			text = block.text;
			break;
		}
	}
	// MCP reports tool-level failures inside a successful envelope. Exa answers a
	// bad key with HTTP 200 and `isError: true`, so trusting the status code alone
	// would misreport an auth failure as "no results".
	if (envelope.result.isError === true) throw new Error(firstLine(text ?? "provider returned an error"));
	return text;
}

/** Error text reaches the model, so keep it to one bounded line. */
function firstLine(text: string): string {
	return text.split("\n", 1)[0]!.trim().slice(0, 300) || "provider returned an error";
}

export interface FailoverOptions<T> {
	providers: ProviderName[];
	timeoutMs: number;
	signal?: AbortSignal;
	/** The tool name, for error text. */
	label: string;
	/** Runs one provider; resolves to undefined when the provider answered with nothing usable. */
	attempt: (provider: ProviderName, signal: AbortSignal) => Promise<T | undefined>;
}

export type FailoverOutcome<T> = { provider: ProviderName; value: T } | { provider: ProviderName; value: undefined };

/**
 * One ordered pass across providers: the next one runs when the current one
 * throws or answers with nothing. Every failure is recorded with its provider
 * name; a caller abort stops the pass immediately and is never a provider failure.
 */
export async function failover<T>(options: FailoverOptions<T>): Promise<FailoverOutcome<T>> {
	const failures: string[] = [];
	let empty: ProviderName | undefined;

	for (const provider of options.providers) {
		if (options.signal?.aborted) throw new Error(`${options.label} cancelled`);
		const signal = AbortSignal.any([
			AbortSignal.timeout(options.timeoutMs),
			...(options.signal ? [options.signal] : []),
		]);
		try {
			const value = await options.attempt(provider, signal);
			if (value !== undefined) return { provider, value };
			empty = provider;
		} catch (error) {
			if (options.signal?.aborted) throw error;
			failures.push(`${provider}: ${describeError(error)}`);
		}
	}

	if (empty) return { provider: empty, value: undefined };
	throw new Error(`${options.label} failed (${failures.join("; ")})`);
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === "TimeoutError") return "timed out";
		if (error.name === "AbortError") return "aborted";
		return error.message;
	}
	return String(error);
}

export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

/** Keeps http(s) URLs only; anything else becomes the empty string. */
export function normalizeUrl(url: string): string {
	return /^https?:\/\//i.test(url) ? url : "";
}

/** `YYYY-MM-DD` from a provider date, or undefined for `N/A` and friends. */
export function normalizeDate(value: string | undefined): string | undefined {
	const match = /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? "");
	return match?.[1];
}

/** Drops Exa's `...` chunk separators, trailing spaces, and blank-line runs. */
export function cleanBody(text: string): string {
	const kept: string[] = [];
	for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
		const trimmedEnd = line.replace(/[ \t]+$/, "");
		const bare = trimmedEnd.trim();
		if (bare === "..." || bare === "…") continue;
		kept.push(trimmedEnd);
	}
	return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Cuts at a word boundary when one is close enough, then marks the cut. */
export function truncate(text: string, limit: number): string {
	if (limit <= 0) return "";
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	const boundary = cut.search(/\s+\S*$/);
	const clipped = boundary > limit * 0.6 ? cut.slice(0, boundary) : cut;
	return `${clipped.trimEnd()}…`;
}
