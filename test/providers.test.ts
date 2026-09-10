import assert from "node:assert/strict";
import test from "node:test";
import {
	cleanBody,
	exaUrl,
	parseExaText,
	parseParallelText,
	readMcpText,
	searchExa,
	searchParallel,
} from "../src/providers.ts";

const EXA_TEXT = `Title: Extension API · Docs · Pi
URL: https://pi.dev/docs/latest/extensions
Published: 2026-03-01T10:00:00.000Z
Author: N/A
Highlights:
Extensions are TypeScript modules.
...
export default function (pi) {}

Title: earendil-works/pi
URL: https://github.com/earendil-works/pi
Published: N/A
Author: N/A
Highlights:
Pi is a coding agent.`;

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

test("readMcpText treats isError payloads as failures", () => {
	const body = JSON.stringify({
		result: {
			content: [
				{ type: "text", text: "web_search_exa error (401): Invalid API key\nTimestamp: 2026-09-10T10:38:35.770Z" },
			],
			isError: true,
		},
	});
	assert.throws(() => readMcpText(body), /web_search_exa error \(401\): Invalid API key$/);
});

test("readMcpText treats SSE isError payloads as failures", () => {
	const body = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "rate limited" }], isError: true } })}\n\n`;
	assert.throws(() => readMcpText(body), /rate limited/);
});

test("readMcpText survives an isError payload without content", () => {
	assert.throws(() => readMcpText(JSON.stringify({ result: { isError: true } })), /provider returned an error/);
});

test("readMcpText keeps error text on one bounded line", () => {
	try {
		readMcpText(JSON.stringify({ jsonrpc: "2.0", error: { message: `boom\nmore detail\n${"x".repeat(5000)}` } }));
		assert.fail("expected a throw");
	} catch (error) {
		const message = (error as Error).message;
		assert.equal(message, "boom");
		assert.ok(message.length <= 300);
	}
});

test("parseExaText extracts compact results", () => {
	const results = parseExaText(EXA_TEXT);
	assert.equal(results.length, 2);
	assert.deepEqual(results[0], {
		title: "Extension API · Docs · Pi",
		url: "https://pi.dev/docs/latest/extensions",
		published: "2026-03-01",
		text: "Extensions are TypeScript modules.\nexport default function (pi) {}",
	});
	assert.equal(results[1]!.published, undefined);
	assert.equal(results[1]!.text, "Pi is a coding agent.");
});

test("parseExaText honors the limit", () => {
	assert.equal(parseExaText(EXA_TEXT, 1).length, 1);
});

test("parseParallelText reads the JSON payload", () => {
	const payload = JSON.stringify({
		search_id: "search_1",
		results: [
			{
				url: "https://example.com/a",
				title: "Example A",
				publish_date: "2026-02-02T00:00:00Z",
				excerpts: ["first part", "second part"],
			},
		],
	});
	const results = parseParallelText(payload);
	assert.deepEqual(results, [
		{
			title: "Example A",
			url: "https://example.com/a",
			published: "2026-02-02",
			text: "first part\n\nsecond part",
		},
	]);
});

test("parseParallelText falls back to the text layout", () => {
	assert.equal(parseParallelText(EXA_TEXT).length, 2);
});

test("cleanBody drops separators and blank-line runs", () => {
	assert.equal(cleanBody("a  \n...\n\n\n\nb"), "a\n\nb");
});

test("exaUrl appends the API key only when present", () => {
	assert.equal(exaUrl(), "https://mcp.exa.ai/mcp");
	assert.equal(exaUrl("k 1"), "https://mcp.exa.ai/mcp?exaApiKey=k+1");
});

test("searchExa sends a JSON-RPC tools/call request", async () => {
	let captured: { url: string; init: RequestInit } | undefined;
	const fetcher = async (url: string, init: RequestInit) => {
		captured = { url, init };
		return new Response(JSON.stringify({ result: { content: [{ type: "text", text: EXA_TEXT }] } }), { status: 200 });
	};
	const results = await searchExa({
		fetcher,
		query: "pi extensions",
		numResults: 3,
		signal: AbortSignal.timeout(1000),
	});
	assert.equal(results.length, 2);
	assert.equal(captured!.url, "https://mcp.exa.ai/mcp");
	const body = JSON.parse(String(captured!.init.body));
	assert.deepEqual(body, {
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: "web_search_exa", arguments: { query: "pi extensions", numResults: 3 } },
	});
});

test("searchParallel sends the bearer token when configured", async () => {
	let captured: RequestInit | undefined;
	const fetcher = async (_url: string, init: RequestInit) => {
		captured = init;
		return new Response(JSON.stringify({ result: { content: [{ type: "text", text: "no json here" }] } }), {
			status: 200,
		});
	};
	await searchParallel({
		fetcher,
		query: "q",
		numResults: 1,
		signal: AbortSignal.timeout(1000),
		apiKey: "secret",
	});
	const headers = captured!.headers as Record<string, string>;
	assert.equal(headers.authorization, "Bearer secret");
	const body = JSON.parse(String(captured!.body));
	assert.equal(body.params.name, "web_search");
	assert.deepEqual(body.params.arguments.search_queries, ["q"]);
});
