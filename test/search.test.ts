import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "../src/config.ts";
import type { Fetcher } from "../src/mcp.ts";
import { formatResults, parseExaText, parseParallelText, prepareSearchArguments, search } from "../src/search.ts";

function mcpText(text: string): Response {
	return new Response(JSON.stringify({ result: { content: [{ type: "text", text }] } }), { status: 200 });
}

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

test("resolveConfig applies defaults", () => {
	const config = resolveConfig({});
	assert.deepEqual(config.providers, ["exa", "parallel"]);
	assert.equal(config.timeoutMs, 12_000);
	assert.deepEqual(config.search, { maxResults: 5, maxChars: 6000, perResultChars: 1200 });
	assert.deepEqual(config.fetch, { maxChars: 8000 });
});

test("resolveConfig honors the environment, clamps, and treats blanks as unset", () => {
	const config = resolveConfig({
		PI_WEB_PROVIDER: "Parallel",
		PI_WEB_SEARCH_RESULTS: "99",
		PI_WEB_SEARCH_CHARS: "10",
		PI_WEB_SEARCH_RESULT_CHARS: "nonsense",
		PI_WEB_FETCH_CHARS: "   ",
		PI_WEB_TIMEOUT_MS: "0",
		EXA_API_KEY: " exa-key ",
	});
	assert.deepEqual(config.providers, ["parallel"]);
	assert.deepEqual(config.search, { maxResults: 10, maxChars: 500, perResultChars: 1200 });
	assert.equal(config.fetch.maxChars, 8000);
	assert.equal(config.timeoutMs, 1000);
	assert.equal(config.exaApiKey, "exa-key");
	assert.equal(config.parallelApiKey, undefined);
});

test("prepareSearchArguments normalizes aliases and numeric strings", () => {
	assert.deepEqual(prepareSearchArguments({ q: "  hello   world " }), { query: "hello world" });
	assert.deepEqual(prepareSearchArguments("plain string"), { query: "plain string" });
	assert.deepEqual(prepareSearchArguments({ query: { text: "nested" }, num_results: "3" }), { query: "nested", numResults: 3 });
	assert.deepEqual(prepareSearchArguments({ query: "x", limit: 99 }), { query: "x", numResults: 10 });
	assert.deepEqual(prepareSearchArguments({ query: "x", limit: 0 }), { query: "x", numResults: 1 });
	assert.deepEqual(prepareSearchArguments({}), { query: "" });
});

test("parseExaText extracts compact results and honors the limit", () => {
	const results = parseExaText(EXA_TEXT);
	assert.equal(results.length, 2);
	assert.deepEqual(results[0], {
		title: "Extension API · Docs · Pi",
		url: "https://pi.dev/docs/latest/extensions",
		published: "2026-03-01",
		text: "Extensions are TypeScript modules.\nexport default function (pi) {}",
	});
	assert.equal(results[1]!.published, undefined);
	assert.equal(parseExaText(EXA_TEXT, 1).length, 1);
});

test("parseParallelText reads JSON and falls back to the text layout", () => {
	const payload = JSON.stringify({
		results: [{ url: "https://example.com/a", title: "Example A", publish_date: "2026-02-02T00:00:00Z", excerpts: ["first part", "second part"] }],
	});
	assert.deepEqual(parseParallelText(payload), [
		{ title: "Example A", url: "https://example.com/a", published: "2026-02-02", text: "first part\n\nsecond part" },
	]);
	assert.equal(parseParallelText(EXA_TEXT).length, 2);
});

test("formatResults renders a numbered compact list", () => {
	const text = formatResults(
		[
			{ title: "First", url: "https://a.example/1", published: "2026-01-02", text: "alpha" },
			{ title: "", url: "https://b.example/2", text: "beta" },
		],
		{ maxChars: 1000, perResultChars: 100 },
	);
	assert.equal(text, "1. [First](https://a.example/1) (2026-01-02)\nalpha\n\n2. [b.example](https://b.example/2)\nbeta");
	assert.equal(formatResults([], { maxChars: 1000, perResultChars: 100 }), "");
});

test("formatResults respects the total budget and reports omissions", () => {
	const results = Array.from({ length: 5 }, (_, i) => ({ title: `Result ${i + 1}`, url: `https://example.com/${i + 1}`, text: "x".repeat(500) }));
	const text = formatResults(results, { maxChars: 900, perResultChars: 500 });
	assert.ok(text.length < 1400, `expected a bounded output, got ${text.length}`);
	assert.match(text, /more results omitted\)$/);
	assert.ok(!text.includes("Result 5"));
});

test("search sends the right tool call and returns a compact result from Exa", async () => {
	let body: any;
	const fetcher: Fetcher = async (_url, init) => {
		body = JSON.parse(String(init.body));
		return mcpText(EXA_TEXT);
	};
	const outcome = await search("pi extensions", 3, resolveConfig({}), { fetcher });
	assert.equal(outcome.provider, "exa");
	assert.equal(outcome.resultCount, 2);
	assert.match(outcome.text, /^1\. \[Extension API · Docs · Pi\]\(https:\/\/pi\.dev/);
	assert.deepEqual(body.params, { name: "web_search_exa", arguments: { query: "pi extensions", numResults: 3 } });
});

test("search fails over to Parallel with its own arguments and bearer token", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetcher: Fetcher = async (url, init) => {
		calls.push({ url, init });
		if (url.includes("exa")) return new Response("nope", { status: 500 });
		return mcpText(JSON.stringify({ results: [{ url: "https://a.test", title: "A", excerpts: ["text"] }] }));
	};
	const outcome = await search("q", 3, resolveConfig({ PARALLEL_API_KEY: "secret" }), { fetcher });
	assert.equal(outcome.provider, "parallel");
	assert.equal(calls.length, 2);
	const body = JSON.parse(String(calls[1]!.init.body));
	assert.equal(body.params.name, "web_search");
	assert.deepEqual(body.params.arguments.search_queries, ["q"]);
	assert.equal((calls[1]!.init.headers as Record<string, string>).authorization, "Bearer secret");
});

test("search reports an empty result set without throwing", async () => {
	const outcome = await search("q", 3, resolveConfig({}), { fetcher: async () => mcpText("nothing to see") });
	assert.equal(outcome.resultCount, 0);
	assert.match(outcome.text, /No search results found/);
});

test("search names the failure when every provider rejects the key", async () => {
	const fetcher: Fetcher = async () =>
		new Response(JSON.stringify({ result: { content: [{ type: "text", text: "error (401): Invalid API key" }], isError: true } }), { status: 200 });
	await assert.rejects(() => search("q", 3, resolveConfig({}), { fetcher }), /search failed \(exa: error \(401\): Invalid API key; parallel: error \(401\): Invalid API key\)/);
});
