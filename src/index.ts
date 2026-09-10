/**
 * pi-lite-websearch: one compact, keyless `websearch` tool.
 *
 * The extension registers a single tool whose entire job is: send one query to
 * a keyless search backend and return a bounded, compact answer. See DESIGN.md.
 */

import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { bindRowDecoration, readToolRowDecoratorHub } from "./row-decoration.ts";
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

/** `details` is what the row renderers and debugging get to work with. */
type WebsearchDetails = { query: string; numResults: number; provider: string };

type WebsearchDefinition = ToolDefinition<typeof PARAMETERS, WebsearchDetails>;

/**
 * The tool definition lives in a factory so the decorated re-registration in the
 * extension body spreads the very same object.
 */
function createDefinition(): WebsearchDefinition {
	return {
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
	};
}

export default function liteWebsearchExtension(pi: ExtensionAPI) {
	const definition = createDefinition();
	pi.registerTool(definition);

	// The row itself may belong to another extension: hand the presentation over
	// when pi-briefly is installed, and keep this extension's own line otherwise.
	// The tool name, schema, description and execution stay ours either way.
	bindRowDecoration(pi, () => {
		const decoration = readToolRowDecoratorHub()?.decorate({
			tool: "websearch",
			native: { renderCall: definition.renderCall, renderShell: "default" },
			schema: { parameters: definition.parameters, prepareArguments: definition.prepareArguments },
		});
		pi.registerTool(decoration ? { ...definition, ...decoration } : definition);
	});
}
