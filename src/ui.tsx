/**
 * The desktop half of this extension.
 *
 * The terminal half is `src/index.ts`. Its two tools each carry a `renderCall` that paints one
 * pi-tui line, which only a terminal can mount. This runs in a window instead and draws the same
 * two rows there, out of the host's own row frame.
 *
 * Both halves read the same `details` the tool already returns — the provider that answered, how
 * many results, how much text — so the window says what the terminal says plus what the terminal
 * has no room for. Neither half knows how the other draws.
 *
 * Declared as `"pid": { "ui": "./src/ui.tsx" }`. A host that has never heard of this file loads the
 * tools alone and loses nothing but the row.
 */

import { Badge, Say } from "@pid/ui";
import type { FetchDetails, SearchDetails } from "./index.ts";

/** What the host hands a tool renderer. Mirrors PID's `ToolDraw`; the host is the source of truth. */
interface Draw {
	call: { name: string; arguments?: unknown };
	run?: { status?: string; isError?: boolean; result?: { details?: unknown } };
	Frame: (props: {
		verb?: string;
		detail?: string;
		meta?: unknown;
		body?: "args" | "command" | "none";
		children?: unknown;
	}) => unknown;
}

interface Api {
	readonly id: string;
	tool: (spec: { names: string[]; render: (draw: Draw) => unknown }) => void;
}

const str = (args: unknown, key: string): string => {
	const v = (args as Record<string, unknown> | undefined)?.[key];
	return typeof v === "string" ? v : "";
};

const done = (draw: Draw): boolean => draw.run?.status !== undefined && draw.run.status !== "running";

/**
 * The end of the row: which backend answered, then how much it returned.
 *
 * The provider is a tinted pill rather than more grey text, which is the whole difference between
 * this row and `read` or `bash` above it. Those go one place and always the same place, so there is
 * nothing to mark. A search went to Exa or to Parallel, and which one it was explains a result that
 * looks different from the last one — a fact worth a glance, and one only this extension has.
 *
 * Nothing is drawn until the call reports. A row that guesses a provider is worse than one that waits.
 */
function meta(provider: string | undefined, parts: (string | undefined)[]): unknown {
	const said = parts.filter((p): p is string => Boolean(p)).join(" · ");
	if (!provider && !said) return undefined;
	return (
		<>
			{provider && <Badge title="the backend that answered">{provider}</Badge>}
			{said && <Say tone="faint">{said}</Say>}
		</>
	);
}

export default function register(pid: Api) {
	pid.tool({
		names: ["search"],
		render: (draw) => {
			const { Frame } = draw;
			const d = draw.run?.result?.details as SearchDetails | undefined;
			return (
				<Frame
					verb={done(draw) ? "Searched the web" : "Searching the web"}
					detail={str(draw.call.arguments, "query")}
					meta={meta(d?.provider, [d ? `${d.numResults} results` : undefined])}
				/>
			);
		},
	});

	pid.tool({
		names: ["fetch"],
		render: (draw) => {
			const { Frame } = draw;
			const d = draw.run?.result?.details as FetchDetails | undefined;
			return (
				<Frame
					verb={done(draw) ? "Fetched" : "Fetching"}
					detail={str(draw.call.arguments, "url")}
					meta={meta(d?.provider, [
						d ? `${d.chars.toLocaleString()} chars` : undefined,
						d?.truncated ? "truncated" : undefined,
					])}
				/>
			);
		},
	});
}
