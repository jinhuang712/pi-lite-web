import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import liteWebExtension from "../src/index.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type Tool = ToolDefinition<any, any, any>;

interface Harness {
	/** The most recent registration per tool name, which is what Pi would use. */
	tools: Map<string, Tool>;
	emit: (event: "session_start" | "session_shutdown") => void;
}

function createHarness(): Harness {
	const tools = new Map<string, Tool>();
	const handlers = new Map<string, Array<() => void>>();
	const pi = {
		registerTool(tool: Tool) {
			tools.set(tool.name, tool);
		},
		on(event: string, handler: () => void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	};
	liteWebExtension(pi as never);
	return {
		tools,
		emit: (event) => {
			for (const handler of handlers.get(event) ?? []) handler();
		},
	};
}

const TOOL_ROW_DECORATOR_KEY = Symbol.for("pi.toolRowDecorator.v1");

function withHub<T>(hub: unknown, run: () => T): T {
	const globals = globalThis as Record<PropertyKey, unknown>;
	const previous = globals[TOOL_ROW_DECORATOR_KEY];
	globals[TOOL_ROW_DECORATOR_KEY] = hub;
	try {
		return run();
	} finally {
		if (previous === undefined) delete globals[TOOL_ROW_DECORATOR_KEY];
		else globals[TOOL_ROW_DECORATOR_KEY] = previous;
	}
}

const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text } as never;
const { tools } = createHarness();
const searchTool = tools.get("search")!;
const fetchTool = tools.get("fetch")!;

test("registers exactly two tools: search and fetch", () => {
	assert.deepEqual([...tools.keys()].sort(), ["fetch", "search"]);
	assert.equal(searchTool.label, "Web Search");
	assert.match(searchTool.description, /current information/);
	assert.match(searchTool.description, new RegExp(String(new Date().getFullYear())));
	assert.equal(fetchTool.label, "Web Fetch");
	assert.match(fetchTool.description, /Read one web page/);
	assert.equal(searchTool.promptGuidelines, undefined);
	assert.equal(fetchTool.promptGuidelines, undefined);
});

test("schemas accept the documented argument shapes", () => {
	assert.ok(Value.Check(searchTool.parameters, { query: "hello" }));
	assert.ok(Value.Check(searchTool.parameters, { query: "hello", numResults: 5 }));
	assert.ok(!Value.Check(searchTool.parameters, {}));
	assert.ok(Value.Check(fetchTool.parameters, { url: "https://a.test" }));
	assert.ok(Value.Check(fetchTool.parameters, { url: "https://a.test", maxChars: 2000 }));
	assert.ok(!Value.Check(fetchTool.parameters, {}));
});

test("prepareArguments is wired on both tools and clamps before validation", () => {
	const searched = searchTool.prepareArguments!({ q: "  spaced   query ", limit: "99" });
	assert.deepEqual(searched, { query: "spaced query", numResults: 10 });
	assert.ok(Value.Check(searchTool.parameters, searched));
	const fetched = fetchTool.prepareArguments!({ link: "example.com", max_chars: "99999999" });
	assert.deepEqual(fetched, { url: "https://example.com", maxChars: 50_000 });
	assert.ok(Value.Check(fetchTool.parameters, fetched));
});

test("renderCall shows the argument and survives partial args", () => {
	type Rendered = { render(width: number): string[] };
	assert.equal((searchTool.renderCall!({ query: "pi coding agent" }, theme, {} as never) as Rendered).render(120).join("\n").trimEnd(), "search pi coding agent");
	assert.equal((searchTool.renderCall!({} as never, theme, {} as never) as Rendered).render(120).join("\n").trim(), "search");
	assert.equal((fetchTool.renderCall!({ url: "https://a.test" }, theme, {} as never) as Rendered).render(120).join("\n").trimEnd(), "fetch https://a.test");
});

test("execute rejects bad input before any network work", async () => {
	await assert.rejects(() => searchTool.execute("call", { query: "   " }, undefined, undefined, {} as never), /non-empty query/);
	await assert.rejects(() => fetchTool.execute("call", { url: "not a url" }, undefined, undefined, {} as never), /full http\(s\) URL/);
});

test("session_start hands both rows over when pi-briefly is installed", () => {
	const harness = createHarness();
	const requested: string[] = [];
	const hub = {
		decorate(request: { tool: string }) {
			requested.push(request.tool);
			return { renderShell: "self", renderCall: () => `DECORATED ${request.tool}` };
		},
		subscribe: () => () => {},
	};
	withHub(hub, () => harness.emit("session_start"));
	assert.deepEqual(requested.sort(), ["fetch", "search"]);
	for (const name of ["search", "fetch"]) {
		const tool = harness.tools.get(name)!;
		assert.equal(tool.renderShell, "self");
		assert.equal((tool.renderCall as unknown as () => string)(), `DECORATED ${name}`);
		assert.equal(tool.name, name);
	}
});

test("session_start keeps the native rows when the hub is absent or declines", () => {
	const harness = createHarness();
	const native = harness.tools.get("search")!.renderCall;
	harness.emit("session_start");
	assert.equal(harness.tools.get("search")!.renderShell, undefined);
	assert.equal(harness.tools.get("search")!.renderCall, native);
	withHub({ decorate: () => undefined, subscribe: () => () => {} }, () => harness.emit("session_start"));
	assert.equal(harness.tools.get("fetch")!.renderShell, undefined);
});
