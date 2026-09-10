/**
 * Tool behavior: configuration, argument normalization, provider failover, and
 * the final text. Kept free of Pi and TypeBox imports so it stays unit-testable
 * without the host runtime.
 */

import { formatResults } from "./format.ts";
import {
	type Fetcher,
	type ProviderName,
	type SearchResult,
	searchExa,
	searchParallel,
} from "./providers.ts";

export const DEFAULT_MAX_RESULTS = 5;
export const HARD_MAX_RESULTS = 10;
export const DEFAULT_MAX_CHARS = 6000;
export const DEFAULT_PER_RESULT_CHARS = 1200;
export const DEFAULT_TIMEOUT_MS = 12_000;
/** A sane query is short; refuse to forward a pasted document. */
export const MAX_QUERY_CHARS = 1000;

export interface WebSearchConfig {
	/** Providers in failover order. */
	providers: ProviderName[];
	maxResults: number;
	maxChars: number;
	perResultChars: number;
	timeoutMs: number;
	exaApiKey?: string;
	parallelApiKey?: string;
}

export interface SearchOptions {
	signal?: AbortSignal;
	fetcher?: Fetcher;
}

export interface SearchOutcome {
	text: string;
	provider: ProviderName;
	resultCount: number;
}

type Env = Record<string, string | undefined>;

export function resolveConfig(env: Env = process.env): WebSearchConfig {
	const override = env.PI_WEBSEARCH_PROVIDER?.trim().toLowerCase();
	const providers: ProviderName[] =
		override === "exa" || override === "parallel" ? [override] : ["exa", "parallel"];
	return {
		providers,
		maxResults: readInt(env.PI_WEBSEARCH_MAX_RESULTS, DEFAULT_MAX_RESULTS, 1, HARD_MAX_RESULTS),
		maxChars: readInt(env.PI_WEBSEARCH_MAX_CHARS, DEFAULT_MAX_CHARS, 500, 50_000),
		perResultChars: readInt(env.PI_WEBSEARCH_PER_RESULT_CHARS, DEFAULT_PER_RESULT_CHARS, 200, 10_000),
		timeoutMs: readInt(env.PI_WEBSEARCH_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 1000, 60_000),
		exaApiKey: nonEmpty(env.EXA_API_KEY),
		parallelApiKey: nonEmpty(env.PARALLEL_API_KEY),
	};
}

/**
 * Normalizes sloppy tool arguments before schema validation: alias field names,
 * coerce numeric strings, and clamp the result count. Weaker models are the
 * reason this exists; a validation round-trip costs more than the guesswork.
 */
export function prepareArguments(args: unknown): { query: string; numResults?: number } {
	if (typeof args === "string") return { query: clampQuery(args) };
	const input = (args ?? {}) as Record<string, unknown>;
	const query = clampQuery(firstString(input.query, input.q, input.search_query, input.query_string, input.text));
	const count = firstNumber(input.numResults, input.num_results, input.maxResults, input.limit, input.count, input.n);
	const result: { query: string; numResults?: number } = { query };
	if (count !== undefined) result.numResults = clampInt(count, 1, HARD_MAX_RESULTS);
	return result;
}

export async function search(
	query: string,
	numResults: number,
	config: WebSearchConfig,
	options: SearchOptions = {},
): Promise<SearchOutcome> {
	const fetcher = options.fetcher ?? fetch;
	const failures: string[] = [];
	let emptyProvider: ProviderName | undefined;

	for (const provider of config.providers) {
		if (options.signal?.aborted) throw new Error("websearch cancelled");
		try {
			const results = await runProvider(provider, query, numResults, config, fetcher, options.signal);
			const text = formatResults(results, { maxChars: config.maxChars, perResultChars: config.perResultChars });
			if (text) return { text, provider, resultCount: results.length };
			emptyProvider = provider;
		} catch (error) {
			// A caller abort is not a provider failure; stop without masking it.
			if (options.signal?.aborted) throw error;
			failures.push(`${provider}: ${describeError(error)}`);
		}
	}

	if (emptyProvider) {
		return {
			text: `No search results found for "${query}". Try a different query.`,
			provider: emptyProvider,
			resultCount: 0,
		};
	}
	throw new Error(`websearch failed (${failures.join("; ")})`);
}

async function runProvider(
	provider: ProviderName,
	query: string,
	numResults: number,
	config: WebSearchConfig,
	fetcher: Fetcher,
	parentSignal: AbortSignal | undefined,
): Promise<SearchResult[]> {
	const signal = AbortSignal.any([
		AbortSignal.timeout(config.timeoutMs),
		...(parentSignal ? [parentSignal] : []),
	]);
	const call =
		provider === "exa"
			? searchExa({ fetcher, query, numResults, signal, apiKey: config.exaApiKey })
			: searchParallel({ fetcher, query, numResults, signal, apiKey: config.parallelApiKey });
	return call;
}

function describeError(error: unknown): string {
	if (error instanceof Error) {
		if (error.name === "TimeoutError") return "timed out";
		if (error.name === "AbortError") return "aborted";
		return error.message;
	}
	return String(error);
}

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? clampInt(value, min, max) : fallback;
}

function clampInt(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function clampQuery(raw: string): string {
	return raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
}

function firstString(...values: unknown[]): string {
	for (const value of values) {
		if (typeof value === "string") return value;
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
		if (value && typeof value === "object") {
			const nested = (value as { text?: unknown; query?: unknown; value?: unknown }).text ??
				(value as { query?: unknown }).query ??
				(value as { value?: unknown }).value;
			if (typeof nested === "string") return nested;
		}
	}
	return "";
}

function firstNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim() !== "") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return undefined;
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}
