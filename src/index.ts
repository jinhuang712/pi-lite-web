/**
 * pi-lite-web: two compact, keyless tools for Pi — `search` and `fetch`.
 *
 * This module owns registration only: names, schemas, descriptions, and the
 * TUI call line. Behavior lives in search.ts and fetch.ts. See DESIGN.md.
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { DEFAULTS, HARD_MAX_RESULTS, resolveConfig } from "./config.ts";
import { fetchPage, HARD_MAX_FETCH_CHARS, prepareFetchArguments } from "./fetch.ts";
import { bindRowDecoration, readToolRowDecoratorHub } from "./row-decoration.ts";
import { prepareSearchArguments, search } from "./search.ts";

const SEARCH_PARAMETERS = Type.Object({
	query: Type.String({
		description: "Search query: a few keywords, or a natural-language description of the page you want.",
	}),
	numResults: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: HARD_MAX_RESULTS,
			description: `Results to return (1-${HARD_MAX_RESULTS}, default ${DEFAULTS.search.maxResults}).`,
		}),
	),
});

const FETCH_PARAMETERS = Type.Object({
	url: Type.String({ description: "Full http(s) URL of the page to read." }),
	maxChars: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: HARD_MAX_FETCH_CHARS,
			description: `Characters to return (default ${DEFAULTS.fetch.maxChars}).`,
		}),
	),
});

type SearchDetails = { query: string; numResults: number; provider: string };
type FetchDetails = { url: string; chars: number; truncated: boolean; provider: string };

type AnyDefinition = ToolDefinition<any, any>;

function searchDefinition(): ToolDefinition<typeof SEARCH_PARAMETERS, SearchDetails> {
	return {
		name: "search",
		label: "Web Search",
		description: [
			"Search the web for current information beyond your knowledge cutoff.",
			"Returns numbered results with a title, link, and a short excerpt; use fetch to read one in full.",
			`Current year: ${new Date().getFullYear()}.`,
		].join(" "),
		promptSnippet: "Search the web for current facts, docs, news, and prices",
		parameters: SEARCH_PARAMETERS,
		prepareArguments: prepareSearchArguments,

		async execute(_toolCallId, params, signal) {
			const config = resolveConfig();
			const query = params.query.trim();
			if (!query) throw new Error("search requires a non-empty query");
			const numResults = Math.min(config.search.maxResults, Math.max(1, Math.trunc(params.numResults ?? config.search.maxResults)));
			const outcome = await search(query, numResults, config, { signal });
			return {
				content: [{ type: "text" as const, text: outcome.text }],
				details: { query, numResults: outcome.resultCount, provider: outcome.provider },
			};
		},

		renderCall(args, theme) {
			const query = typeof args?.query === "string" ? args.query : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("search"))} ${theme.fg("toolOutput", query)}`, 0, 0);
		},
	};
}

function fetchDefinition(): ToolDefinition<typeof FETCH_PARAMETERS, FetchDetails> {
	return {
		name: "fetch",
		label: "Web Fetch",
		description: [
			"Read one web page as clean text.",
			"Use it after search when an excerpt is not enough, or to read a URL the user gave you.",
			"Output is cut at a character budget and says so when truncated.",
		].join(" "),
		promptSnippet: "Read a web page by URL as clean text",
		parameters: FETCH_PARAMETERS,
		prepareArguments: prepareFetchArguments,

		async execute(_toolCallId, params, signal) {
			const config = resolveConfig();
			const url = params.url.trim();
			if (!/^https?:\/\/[^\s/]+/i.test(url)) throw new Error("fetch requires a full http(s) URL");
			const maxChars = Math.min(config.fetch.maxChars, Math.max(1, Math.trunc(params.maxChars ?? config.fetch.maxChars)));
			const outcome = await fetchPage(url, maxChars, config, { signal });
			return {
				content: [{ type: "text" as const, text: outcome.text }],
				details: { url, chars: outcome.chars, truncated: outcome.truncated, provider: outcome.provider },
			};
		},

		renderCall(args, theme) {
			const url = typeof args?.url === "string" ? args.url : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("fetch"))} ${theme.fg("toolOutput", url)}`, 0, 0);
		},
	};
}

export default function liteWebExtension(pi: ExtensionAPI) {
	const definitions: AnyDefinition[] = [searchDefinition(), fetchDefinition()];
	for (const definition of definitions) pi.registerTool(definition);

	// The row may belong to another extension: hand the presentation over when
	// pi-briefly is installed, and keep this extension's own line otherwise.
	// The tool name, schema, description and execution stay ours either way.
	bindRowDecoration(pi, () => {
		const hub = readToolRowDecoratorHub();
		for (const definition of definitions) {
			const decoration = hub?.decorate({
				tool: definition.name,
				native: { renderCall: definition.renderCall, renderShell: "default" },
				schema: { parameters: definition.parameters, prepareArguments: definition.prepareArguments },
			});
			pi.registerTool(decoration ? { ...definition, ...decoration } : definition);
		}
	});
}
