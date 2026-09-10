import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "typebox/value";
import liteWebsearchExtension from "../src/index.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

type Tool = ToolDefinition<any, any, any>;

function captureTool(): Tool {
	let captured: Tool | undefined;
	const pi = {
		registerTool(tool: Tool) {
			captured = tool;
		},
	};
	liteWebsearchExtension(pi as never);
	assert.ok(captured, "extension must register a tool");
	return captured;
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
