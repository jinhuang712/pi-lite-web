import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import liteWebsearchExtension from "../src/index.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type Tool = ToolDefinition<any, any, any>;

interface Harness {
	tool: Tool;
	/** The most recent registration, which is what Pi would use. */
	current: () => Tool;
	emit: (event: "session_start" | "session_shutdown") => void;
}

function createHarness(): Harness {
	let captured: Tool | undefined;
	const handlers = new Map<string, Array<() => void>>();
	const pi = {
		registerTool(tool: Tool) {
			captured = tool;
		},
		on(event: string, handler: () => void) {
			const list = handlers.get(event) ?? [];
			list.push(handler);
			handlers.set(event, list);
		},
	};
	liteWebsearchExtension(pi as never);
	assert.ok(captured, "extension must register a tool");
	return {
		tool: captured,
		current: () => {
			assert.ok(captured);
			return captured;
		},
		emit: (event) => {
			for (const handler of handlers.get(event) ?? []) handler();
		},
	};
}

function captureTool(): Tool {
	return createHarness().tool;
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

const tool = captureTool();

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} as never;

test("registers exactly one websearch tool", () => {
	assert.equal(tool.name, "websearch");
	assert.equal(tool.label, "Web Search");
	assert.match(tool.description, /current information/);
	assert.match(tool.description, new RegExp(String(new Date().getFullYear())));
	assert.equal(tool.promptSnippet, "Search the web for current facts, docs, news, and prices");
	assert.equal(tool.promptGuidelines, undefined);
});

test("schema accepts the documented argument shapes", () => {
	assert.ok(Value.Check(tool.parameters, { query: "hello" }));
	assert.ok(Value.Check(tool.parameters, { query: "hello", numResults: 5 }));
	assert.ok(!Value.Check(tool.parameters, {}));
	assert.ok(!Value.Check(tool.parameters, { query: 42 }));
});

test("prepareArguments is wired and clamps before validation", () => {
	const prepare = tool.prepareArguments!;
	const normalized = prepare({ q: "  spaced   query ", limit: "99" });
	assert.deepEqual(normalized, { query: "spaced query", numResults: 10 });
	assert.ok(Value.Check(tool.parameters, normalized));
});

test("renderCall shows the query and survives partial args", () => {
	const full = tool.renderCall!({ query: "pi coding agent" }, theme, {} as never) as { render(width: number): string[] };
	assert.equal(full.render(120).join("\n").trimEnd(), "websearch pi coding agent");
	const partial = tool.renderCall!({} as never, theme, {} as never) as { render(width: number): string[] };
	assert.equal(partial.render(120).join("\n").trim(), "websearch");
});

test("execute rejects an empty query before any network work", async () => {
	await assert.rejects(() => tool.execute("call", { query: "   " }, undefined, undefined, {} as never), /non-empty query/);
});

test("session_start hands the row over when pi-briefly is installed", () => {
	const harness = createHarness();
	const requests: unknown[] = [];
	const listener = { current: undefined as (() => void) | undefined };
	const hub = {
		decorate(request: unknown) {
			requests.push(request);
			return { renderShell: "self", renderCall: () => "DECORATED" };
		},
		subscribe(next: () => void) {
			listener.current = next;
			return () => {
				listener.current = undefined;
			};
		},
	};

	withHub(hub, () => {
		harness.emit("session_start");
		assert.deepEqual(requests, [
			{
				tool: "websearch",
				native: { renderCall: harness.tool.renderCall, renderShell: "default" },
				schema: { parameters: harness.tool.parameters, prepareArguments: harness.tool.prepareArguments },
			},
		]);
		assert.equal(harness.current().renderShell, "self");
		const decorated = harness.current().renderCall as unknown as () => string;
		assert.equal(decorated(), "DECORATED");

		// The switch flips mid-session: the decoration is re-applied without a restart.
		assert.ok(listener.current);
	});
});

test("session_start restores the native row when the hub is absent or declines", () => {
	const harness = createHarness();
	const nativeCall = harness.tool.renderCall;

	harness.emit("session_start");
	assert.equal(harness.tool.renderShell, undefined);
	assert.equal(nativeCall, harness.current().renderCall);

	withHub({ decorate: () => undefined, subscribe: () => () => {} }, () => {
		harness.emit("session_start");
	});
	assert.equal(harness.tool.renderShell, undefined);
	assert.equal(harness.current().renderCall, nativeCall);
});
