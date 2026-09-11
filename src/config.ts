/**
 * Environment-only configuration shared by both tools. Every value has a
 * working default; an unset, blank, or invalid variable changes nothing.
 */

import type { ProviderName } from "./mcp.ts";

export const HARD_MAX_RESULTS = 10;

export interface WebConfig {
	/** Providers in failover order, applied to search and fetch alike. */
	providers: ProviderName[];
	timeoutMs: number;
	exaApiKey?: string;
	parallelApiKey?: string;
	search: {
		/** Results requested per search; also the ceiling for what the model may ask for. */
		maxResults: number;
		/** Soft ceiling for the whole rendered result list. */
		maxChars: number;
		/** Ceiling for one result's excerpt. */
		perResultChars: number;
	};
	fetch: {
		/** Ceiling for one fetched page; also the ceiling for what the model may ask for. */
		maxChars: number;
	};
}

export const DEFAULTS: WebConfig = {
	providers: ["exa", "parallel"],
	timeoutMs: 12_000,
	search: { maxResults: 5, maxChars: 6000, perResultChars: 1200 },
	fetch: { maxChars: 8000 },
};

type Env = Record<string, string | undefined>;

export function resolveConfig(env: Env = process.env): WebConfig {
	const pinned = env.PI_WEB_PROVIDER?.trim().toLowerCase();
	return {
		providers: pinned === "exa" || pinned === "parallel" ? [pinned] : [...DEFAULTS.providers],
		timeoutMs: readInt(env.PI_WEB_TIMEOUT_MS, DEFAULTS.timeoutMs, 1000, 60_000),
		exaApiKey: nonEmpty(env.EXA_API_KEY),
		parallelApiKey: nonEmpty(env.PARALLEL_API_KEY),
		search: {
			maxResults: readInt(env.PI_WEB_SEARCH_RESULTS, DEFAULTS.search.maxResults, 1, HARD_MAX_RESULTS),
			maxChars: readInt(env.PI_WEB_SEARCH_CHARS, DEFAULTS.search.maxChars, 500, 50_000),
			perResultChars: readInt(env.PI_WEB_SEARCH_RESULT_CHARS, DEFAULTS.search.perResultChars, 200, 10_000),
		},
		fetch: {
			maxChars: readInt(env.PI_WEB_FETCH_CHARS, DEFAULTS.fetch.maxChars, 500, 50_000),
		},
	};
}

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
	if (raw === undefined || raw.trim() === "") return fallback;
	const value = Number(raw);
	return Number.isFinite(value) ? clampInt(value, min, max) : fallback;
}

export function clampInt(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, Math.trunc(value)));
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

/** First string-like value among sloppy tool arguments; nested `{text}` objects count. */
export function firstString(...values: unknown[]): string {
	for (const value of values) {
		if (typeof value === "string") return value;
		if (typeof value === "number" && Number.isFinite(value)) return String(value);
		if (value && typeof value === "object") {
			const nested = value as { text?: unknown; query?: unknown; url?: unknown; value?: unknown };
			const inner = nested.text ?? nested.query ?? nested.url ?? nested.value;
			if (typeof inner === "string") return inner;
		}
	}
	return "";
}

/** First finite number among sloppy tool arguments; numeric strings count. */
export function firstNumber(...values: unknown[]): number | undefined {
	for (const value of values) {
		if (typeof value === "number" && Number.isFinite(value)) return value;
		if (typeof value === "string" && value.trim() !== "") {
			const parsed = Number(value);
			if (Number.isFinite(parsed)) return parsed;
		}
	}
	return undefined;
}
