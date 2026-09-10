/**
 * Result compaction. Search payloads are large (Exa returned ~20KB for five
 * results in testing), so the tool renders a compact numbered list instead:
 * title, link, optional date, and a truncated excerpt. Every character here
 * is context the model pays for, so the budget is explicit and bounded.
 */

import { hostOf, type SearchResult } from "./providers.ts";

export interface FormatOptions {
	/** Soft ceiling for the whole rendered output. */
	maxChars: number;
	/** Ceiling for one result's excerpt. */
	perResultChars: number;
}

/** Below this the excerpt stops earning its tokens; skip the result instead. */
const MIN_EXCERPT = 160;

export function formatResults(results: SearchResult[], options: FormatOptions): string {
	if (results.length === 0) return "";

	const blocks: string[] = [];
	let used = 0;
	let included = 0;

	for (const result of results) {
		const label = result.title || hostOf(result.url) || "result";
		const link = result.url ? `[${label}](${result.url})` : label;
		const head = `${included + 1}. ${link}${result.published ? ` (${result.published})` : ""}`;
		const room = options.maxChars - used - head.length - 2;
		if (included > 0 && room < MIN_EXCERPT) break;

		const excerpt = truncateExcerpt(result.text, Math.max(MIN_EXCERPT, Math.min(options.perResultChars, room)));
		const block = excerpt ? `${head}\n${excerpt}` : head;
		blocks.push(block);
		used += block.length + 2;
		included++;
	}

	const omitted = results.length - included;
	const suffix = omitted > 0 ? `\n\n(+${omitted} more result${omitted === 1 ? "" : "s"} omitted)` : "";
	return blocks.join("\n\n") + suffix;
}

/** Cuts at a word boundary when one is close enough, then marks the cut. */
export function truncateExcerpt(text: string, limit: number): string {
	if (limit <= 0) return "";
	if (text.length <= limit) return text;
	const cut = text.slice(0, limit);
	const boundary = cut.search(/\s+\S*$/);
	const clipped = boundary > limit * 0.6 ? cut.slice(0, boundary) : cut;
	return `${clipped.trimEnd()}…`;
}
