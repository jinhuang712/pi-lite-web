import assert from "node:assert/strict";
import test from "node:test";
import { prepareArguments, resolveConfig, search } from "../src/websearch.ts";
import type { Fetcher } from "../src/providers.ts";

function exaResponse(text: string): Response {
	return new Response(JSON.stringify({ result: { content: [{ type: "text", text }] } }), { status: 200 });
}

const EXA_TEXT = `Title: Result
URL: https://example.com/1
Published: N/A
Author: N/A
Highlights:
Useful excerpt.`;

test("resolveConfig applies defaults", () => {
	const config = resolveConfig({});
	assert.deepEqual(config.providers, ["exa", "parallel"]);
	assert.equal(config.maxResults, 5);
	assert.equal(config.maxChars, 6000);
	assert.equal(config.perResultChars, 1200);
	assert.equal(config.timeoutMs, 12_000);
});

test("resolveConfig honors the environment and clamps values", () => {
	const config = resolveConfig({
		PI_WEBSEARCH_PROVIDER: "Parallel",
		PI_WEBSEARCH_MAX_RESULTS: "99",
		PI_WEBSEARCH_MAX_CHARS: "10",
		PI_WEBSEARCH_PER_RESULT_CHARS: "nonsense",
		PI_WEBSEARCH_TIMEOUT_MS: "0",
		EXA_API_KEY: " exa-key ",
	});
	assert.deepEqual(config.providers, ["parallel"]);
	assert.equal(config.maxResults, 10);
	assert.equal(config.maxChars, 500);
	assert.equal(config.perResultChars, 1200);
	assert.equal(config.timeoutMs, 1000);
	assert.equal(config.exaApiKey, "exa-key");
});

test("resolveConfig treats blank values as unset", () => {
	const config = resolveConfig({ PI_WEBSEARCH_MAX_RESULTS: "", PI_WEBSEARCH_MAX_CHARS: "   " });
	assert.equal(config.maxResults, 5);
	assert.equal(config.maxChars, 6000);
});

test("prepareArguments normalizes aliases and numeric strings", () => {
	assert.deepEqual(prepareArguments({ q: "  hello   world " }), { query: "hello world" });
	assert.deepEqual(prepareArguments("plain string"), { query: "plain string" });
	assert.deepEqual(prepareArguments({ query: { text: "nested" }, num_results: "3" }), {
		query: "nested",
		numResults: 3,
	});
	assert.deepEqual(prepareArguments({ query: "x", limit: 99 }), { query: "x", numResults: 10 });
	assert.deepEqual(prepareArguments({ query: "x", limit: 0 }), { query: "x", numResults: 1 });
	assert.deepEqual(prepareArguments({}), { query: "" });
});

test("search returns a compact result from the first provider", async () => {
	const outcome = await search("query", 3, resolveConfig({}), { fetcher: async () => exaResponse(EXA_TEXT) });
	assert.equal(outcome.provider, "exa");
	assert.equal(outcome.resultCount, 1);
	assert.match(outcome.text, /^1\. \[Result\]\(https:\/\/example\.com\/1\)/);
});

test("search fails over to the second provider", async () => {
	const calls: string[] = [];
	const fetcher: Fetcher = async (url) => {
		calls.push(url);
		if (calls.length === 1) return new Response("nope", { status: 500 });
		return exaResponse(EXA_TEXT);
	};
	const outcome = await search("query", 3, resolveConfig({}), { fetcher });
	assert.equal(outcome.provider, "parallel");
	assert.equal(calls.length, 2);
});

test("search reports a combined failure when every provider fails", async () => {
	const fetcher: Fetcher = async () => new Response("nope", { status: 500 });
	await assert.rejects(
		() => search("query", 3, resolveConfig({}), { fetcher }),
		/websearch failed \(exa: HTTP 500; parallel: HTTP 500\)/,
	);
});

test("search reports an empty result set without throwing", async () => {
	const fetcher: Fetcher = async () => exaResponse("nothing to see");
	const outcome = await search("query", 3, resolveConfig({}), { fetcher });
	assert.equal(outcome.resultCount, 0);
	assert.match(outcome.text, /No search results found/);
});

test("search reports an invalid key as a provider failure, then fails over", async () => {
	const calls: string[] = [];
	const fetcher: Fetcher = async (url) => {
		calls.push(url);
		if (url.includes("mcp.exa.ai")) {
			return new Response(
				JSON.stringify({
					result: {
						content: [{ type: "text", text: "web_search_exa error (401): Invalid API key\nTimestamp: 2026" }],
						isError: true,
					},
				}),
				{ status: 200 },
			);
		}
		return exaResponse(EXA_TEXT);
	};
	const outcome = await search("query", 3, resolveConfig({}), { fetcher });
	assert.equal(outcome.provider, "parallel");
	assert.equal(calls.length, 2);
});

test("search names the invalid key when every provider rejects it", async () => {
	const fetcher: Fetcher = async () =>
		new Response(
			JSON.stringify({ result: { content: [{ type: "text", text: "error (401): Invalid API key" }], isError: true } }),
			{ status: 200 },
		);
	await assert.rejects(
		() => search("query", 3, resolveConfig({}), { fetcher }),
		/websearch failed \(exa: error \(401\): Invalid API key; parallel: error \(401\): Invalid API key\)/,
	);
});

test("search stops immediately when the caller aborts", async () => {
	const controller = new AbortController();
	controller.abort();
	let called = false;
	const fetcher: Fetcher = async () => {
		called = true;
		return exaResponse(EXA_TEXT);
	};
	await assert.rejects(() => search("query", 3, resolveConfig({}), { fetcher, signal: controller.signal }), /cancelled/);
	assert.equal(called, false);
});
