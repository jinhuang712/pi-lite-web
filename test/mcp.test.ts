import assert from "node:assert/strict";
import test from "node:test";
import { callMcp, cleanBody, exaUrl, failover, readMcpText, truncate } from "../src/mcp.ts";

test("readMcpText reads plain JSON", () => {
	const body = JSON.stringify({ result: { content: [{ type: "text", text: "hello" }] } });
	assert.equal(readMcpText(body), "hello");
});

test("readMcpText reads SSE framing", () => {
	const body = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "world" }] } })}\n\n`;
	assert.equal(readMcpText(body), "world");
});

test("readMcpText surfaces MCP errors", () => {
	const body = JSON.stringify({ jsonrpc: "2.0", error: { code: -32602, message: "bad arguments" } });
	assert.throws(() => readMcpText(body), /bad arguments/);
});

test("readMcpText ignores non-payload bodies", () => {
	assert.equal(readMcpText(""), undefined);
	assert.equal(readMcpText("<html>nope</html>"), undefined);
});

test("readMcpText treats isError payloads as failures, in JSON and SSE", () => {
	const json = JSON.stringify({
		result: { content: [{ type: "text", text: "web_search_exa error (401): Invalid API key\nTimestamp: 2026" }], isError: true },
	});
	assert.throws(() => readMcpText(json), /web_search_exa error \(401\): Invalid API key$/);
	const sse = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "rate limited" }], isError: true } })}\n\n`;
	assert.throws(() => readMcpText(sse), /rate limited/);
	assert.throws(() => readMcpText(JSON.stringify({ result: { isError: true } })), /provider returned an error/);
});

test("readMcpText keeps error text on one bounded line", () => {
	assert.throws(
		() => readMcpText(JSON.stringify({ jsonrpc: "2.0", error: { message: `boom\nmore detail\n${"x".repeat(5000)}` } })),
		(error: Error) => error.message === "boom",
	);
});

test("callMcp posts a JSON-RPC tools/call envelope and rejects non-2xx", async () => {
	let captured: { url: string; init: RequestInit } | undefined;
	const fetcher = async (url: string, init: RequestInit) => {
		captured = { url, init };
		return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "ok" }] } }), { status: 200 });
	};
	const text = await callMcp({ fetcher, url: "https://x.test/mcp", tool: "t", args: { a: 1 }, headers: { authorization: "Bearer k" }, signal: AbortSignal.timeout(1000) });
	assert.equal(text, "ok");
	assert.equal(captured!.url, "https://x.test/mcp");
	assert.deepEqual(JSON.parse(String(captured!.init.body)), { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "t", arguments: { a: 1 } } });
	assert.equal((captured!.init.headers as Record<string, string>).authorization, "Bearer k");

	await assert.rejects(
		() => callMcp({ fetcher: async () => new Response("nope", { status: 500 }), url: "u", tool: "t", args: {}, signal: AbortSignal.timeout(1000) }),
		/HTTP 500/,
	);
});

test("exaUrl appends the API key only when present", () => {
	assert.equal(exaUrl(), "https://mcp.exa.ai/mcp");
	assert.equal(exaUrl("k 1"), "https://mcp.exa.ai/mcp?exaApiKey=k+1");
});

test("failover moves to the next provider on a throw or an empty answer", async () => {
	const seen: string[] = [];
	const outcome = await failover<string>({
		label: "t",
		providers: ["exa", "parallel"],
		timeoutMs: 1000,
		attempt: async (provider) => {
			seen.push(provider);
			if (provider === "exa") throw new Error("HTTP 500");
			return "answer";
		},
	});
	assert.deepEqual(outcome, { provider: "parallel", value: "answer" });
	assert.deepEqual(seen, ["exa", "parallel"]);

	const empty = await failover<string>({ label: "t", providers: ["exa", "parallel"], timeoutMs: 1000, attempt: async () => undefined });
	assert.deepEqual(empty, { provider: "parallel", value: undefined });
});

test("failover names every provider when all of them fail", async () => {
	await assert.rejects(
		() => failover({ label: "t", providers: ["exa", "parallel"], timeoutMs: 1000, attempt: async () => { throw new Error("HTTP 500"); } }),
		/t failed \(exa: HTTP 500; parallel: HTTP 500\)/,
	);
});

test("failover stops immediately when the caller aborts", async () => {
	const controller = new AbortController();
	controller.abort();
	let called = false;
	await assert.rejects(
		() => failover({ label: "t", providers: ["exa"], timeoutMs: 1000, signal: controller.signal, attempt: async () => { called = true; return "x"; } }),
		/t cancelled/,
	);
	assert.equal(called, false);
});

test("cleanBody drops separators and blank-line runs", () => {
	assert.equal(cleanBody("a  \n...\n\n\n\nb"), "a\n\nb");
});

test("truncate cuts at a word boundary and marks the cut", () => {
	assert.equal(truncate("hello world", 100), "hello world");
	assert.equal(truncate("hello world again", 13), "hello world…");
	assert.equal(truncate("abcdefghij", 5), "abcde…");
});
