import assert from "node:assert/strict";
import test from "node:test";
import { resolveConfig } from "../src/config.ts";
import { fetchPage, formatPage, parseExaPage, parseParallelPage, prepareFetchArguments } from "../src/fetch.ts";
import type { Fetcher } from "../src/mcp.ts";

function mcpText(text: string): Response {
	return new Response(JSON.stringify({ result: { content: [{ type: "text", text }] } }), { status: 200 });
}

const EXA_PAGE = `# Example Domain
URL: https://example.com

Example Domain

# Example Domain

This domain is for use in documentation examples without needing permission.`;

const PARALLEL_PAGE = JSON.stringify({
	results: [{ url: "https://example.com", title: "Example Domain", publish_date: null, excerpts: ["short"], full_content: "# Example Domain\n\nFull body." }],
	errors: [],
});

test("prepareFetchArguments normalizes aliases, bare strings, and a missing scheme", () => {
	assert.deepEqual(prepareFetchArguments("example.com/a"), { url: "https://example.com/a" });
	assert.deepEqual(prepareFetchArguments({ link: " <https://a.test> ", max_chars: "500" }), { url: "https://a.test", maxChars: 500 });
	assert.deepEqual(prepareFetchArguments({ url: "https://a.test", limit: 10_000_000 }), { url: "https://a.test", maxChars: 50_000 });
	assert.deepEqual(prepareFetchArguments({}), { url: "" });
});

test("parseExaPage keeps the body and drops the header and repeated title", () => {
	assert.deepEqual(parseExaPage(EXA_PAGE, "https://example.com/requested"), {
		title: "Example Domain",
		url: "https://example.com",
		text: "This domain is for use in documentation examples without needing permission.",
	});
	assert.equal(parseExaPage("", "https://x.test"), undefined);
});

test("parseParallelPage prefers full_content, falls back to excerpts, and surfaces errors", () => {
	assert.deepEqual(parseParallelPage(PARALLEL_PAGE, "https://x.test"), { title: "Example Domain", url: "https://example.com", text: "# Example Domain\n\nFull body." });
	const excerptsOnly = JSON.stringify({ results: [{ url: "https://a.test", title: "A", excerpts: ["one", "two"], full_content: null }] });
	assert.equal(parseParallelPage(excerptsOnly, "https://a.test")!.text, "one\n\ntwo");
	assert.throws(() => parseParallelPage(JSON.stringify({ results: [], errors: [{ message: "fetch failed: 404\nmore" }] }), "u"), /^Error: fetch failed: 404$/);
	assert.equal(parseParallelPage(JSON.stringify({ results: [] }), "u"), undefined);
	assert.equal(parseParallelPage("plain text", "https://p.test")!.text, "plain text");
});

test("formatPage links the title, cuts at the budget, and marks the cut", () => {
	const short = formatPage({ title: "T", url: "https://a.test", text: "body" }, "https://a.test", 100);
	assert.deepEqual(short, { text: "[T](https://a.test)\n\nbody", chars: 4, truncated: false });
	const long = formatPage({ title: "", url: "", text: "word ".repeat(100).trim() }, "https://a.test/p", 120);
	assert.match(long.text, /^\[a\.test\]\(https:\/\/a\.test\/p\)\n\n(word )+word…\n\n\(truncated at 120 characters\)$/);
	assert.equal(long.truncated, true);
});

test("fetchPage asks Exa for the URL with a character cap and renders the page", async () => {
	let body: any;
	const fetcher: Fetcher = async (_url, init) => {
		body = JSON.parse(String(init.body));
		return mcpText(EXA_PAGE);
	};
	const outcome = await fetchPage("https://example.com", 500, resolveConfig({}), { fetcher });
	assert.equal(outcome.provider, "exa");
	assert.equal(outcome.truncated, false);
	assert.deepEqual(body.params, { name: "web_fetch_exa", arguments: { urls: ["https://example.com"], maxCharacters: 700 } });
	assert.match(outcome.text, /^\[Example Domain\]\(https:\/\/example\.com\)\n\nThis domain/);
});

test("fetchPage fails over to Parallel and asks for full content", async () => {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetcher: Fetcher = async (url, init) => {
		calls.push({ url, init });
		if (url.includes("exa")) return new Response("nope", { status: 500 });
		return mcpText(PARALLEL_PAGE);
	};
	const outcome = await fetchPage("https://example.com", 500, resolveConfig({}), { fetcher });
	assert.equal(outcome.provider, "parallel");
	const body = JSON.parse(String(calls[1]!.init.body));
	assert.equal(body.params.name, "web_fetch");
	assert.deepEqual(body.params.arguments.urls, ["https://example.com"]);
	assert.equal(body.params.arguments.full_content, true);
	assert.match(outcome.text, /Full body\./);
});

test("fetchPage reports an unreadable page without throwing, and names combined failures", async () => {
	const empty = await fetchPage("https://example.com", 500, resolveConfig({}), { fetcher: async () => mcpText("") });
	assert.equal(empty.chars, 0);
	assert.match(empty.text, /Nothing readable at https:\/\/example\.com/);
	await assert.rejects(
		() => fetchPage("https://example.com", 500, resolveConfig({}), { fetcher: async () => new Response("x", { status: 502 }) }),
		/fetch failed \(exa: HTTP 502; parallel: HTTP 502\)/,
	);
});
