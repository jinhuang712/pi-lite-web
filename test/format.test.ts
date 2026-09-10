import assert from "node:assert/strict";
import test from "node:test";
import { formatResults, truncateExcerpt } from "../src/format.ts";

test("truncateExcerpt cuts at a word boundary", () => {
	assert.equal(truncateExcerpt("hello world", 100), "hello world");
	assert.equal(truncateExcerpt("hello world again", 13), "hello world…");
});

test("truncateExcerpt marks hard cuts", () => {
	assert.equal(truncateExcerpt("abcdefghij", 5), "abcde…");
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
});

test("formatResults respects the total budget and reports omissions", () => {
	const results = Array.from({ length: 5 }, (_, index) => ({
		title: `Result ${index + 1}`,
		url: `https://example.com/${index + 1}`,
		text: "x".repeat(500),
	}));
	const text = formatResults(results, { maxChars: 900, perResultChars: 500 });
	assert.ok(text.length < 1400, `expected a bounded output, got ${text.length}`);
	assert.match(text, /more results omitted\)$/);
	assert.ok(!text.includes("Result 5"));
});

test("formatResults returns empty text for no results", () => {
	assert.equal(formatResults([], { maxChars: 1000, perResultChars: 100 }), "");
});
