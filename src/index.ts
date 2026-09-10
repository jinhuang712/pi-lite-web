/**
 * pi-lite-websearch: one compact, keyless `websearch` tool.
 *
 * The extension registers a single tool whose entire job is: send one query to
 * a keyless search backend and return a bounded, compact answer. See DESIGN.md.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { DEFAULT_MAX_RESULTS, HARD_MAX_RESULTS, prepareArguments, resolveConfig, search } from "./websearch.ts";

const PARAMETERS = Type.Object({
	query: Type.String({
		description: "Search query: a few keywords, or a natural-language description of the page you want.",
	}),
	numResults: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: HARD_MAX_RESULTS,
			description: `Results to return (1-${HARD_MAX_RESULTS}, default ${DEFAULT_MAX_RESULTS}).`,
		}),
	),
});

const DESCRIPTION = [
	"Search the web for current information beyond your knowledge cutoff.",
	"Returns numbered results with a title, link, and a short excerpt.",
	`Current year: ${new Date().getFullYear()}.`,
].join(" ");

export default function liteWebsearchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "websearch",
		label: "Web Search",
		description: DESCRIPTION,
		promptSnippet: "Search the web for current facts, docs, news, and prices",
		parameters: PARAMETERS,
		prepareArguments,

		async execute(_toolCallId, params, signal) {
			const config = resolveConfig();
			const query = params.query.trim();
			if (!query) throw new Error("websearch requires a non-empty query");
			const numResults = Math.min(config.maxResults, Math.max(1, Math.trunc(params.numResults ?? config.maxResults)));

			const outcome = await search(query, numResults, config, { signal });
			return {
				content: [{ type: "text" as const, text: outcome.text }],
				details: { query, numResults: outcome.resultCount, provider: outcome.provider },
			};
		},

		renderCall(args, theme) {
			const query = typeof args?.query === "string" ? args.query : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("websearch"))} ${theme.fg("toolOutput", query)}`, 0, 0);
		},
	});
}
