# Changelog

All notable changes to `pi-lite-websearch` are documented here.

## [Unreleased]

### Added

- The call line can be handed over to [pi-briefly](https://github.com/jinhuang712/pi-briefly) through the row decorator hub (`Symbol.for("pi.toolRowDecorator.v1")`): with pi-briefly installed and terse mode on, `websearch` renders as one gray line carrying the query. Nothing imports pi-briefly, the tool name, schema, description, `prepareArguments` and `execute` stay here, and without the hub the registration is unchanged.
- The handshake re-applies on `session_start` and on `hub.subscribe(...)`, so the row follows the `/briefly` switch without a restart, and no import order between the two extensions matters.

## [0.1.0] - 2026-09-10

### Added

- The `websearch` tool: one keyless search per call, rendered as a numbered list of `[title](url) (date)` plus a truncated excerpt, with `details` (`query`, `numResults`, `provider`) for renderers and debugging.
- Exa as the primary backend and Parallel as automatic failover, both over MCP-over-HTTP (one `tools/call` JSON-RPC POST). No SDK, no API key, no MCP server process.
- An explicit output budget: `maxChars` 6000, `perResultChars` 1200, `maxResults` 5 by default, all adjustable by environment variable. The configured `maxResults` is also the ceiling for what the model may request.
- `prepareArguments` normalization for weak models: field aliases (`q`, `search_query`, `query_string`, `num_results`, `limit`, `count`, `maxResults`), numeric strings, nested `{text}` queries, whitespace collapsing, and clamping to 1–10 results before schema validation.
- Tolerant response handling: plain JSON and SSE framing, an Exa text-layout parser, a Parallel JSON parser with a text-layout fallback, and a 2 MB body ceiling.
- A `websearch <query>` call line in the TUI; results use Pi's default expandable renderer.
- Environment configuration: `EXA_API_KEY`, `PARALLEL_API_KEY`, `PI_WEBSEARCH_PROVIDER`, `PI_WEBSEARCH_MAX_RESULTS`, `PI_WEBSEARCH_MAX_CHARS`, `PI_WEBSEARCH_PER_RESULT_CHARS`, `PI_WEBSEARCH_TIMEOUT_MS`.

### Fixed

- An MCP `result.isError: true` payload is now treated as a provider failure instead of an empty result. Exa answers an invalid API key with HTTP 200 and `isError`, which previously surfaced as `No search results found` and hid the real 401.
- Provider error text is reduced to one bounded line (300 characters) so a failing endpoint cannot flood the context through its error message.
- Blank environment variables fall back to defaults instead of clamping to the minimum.

### Documentation

- `GOALS.md` (measurable goals and non-goals), `PHILOSOPHY.md` (decision clauses and checklist), `DESIGN.md` (providers, budgets, failover, decision log), `AGENTS.md` (repository rules) and `GITFLOW.md` (commit conventions).

### Verified

- `npm test`: 37 tests, no network access, fake `Fetcher` injection.
- `npm run typecheck`: strict TypeScript, no emit.
- Zero-config search with a completely stripped environment (`env -i`, no keys at all): 3 results in 1.7 s.
- Compaction: the same Exa query returned 20,834 characters raw and 5,450 characters rendered (−73%).
- Live latency: Exa 1.4–1.6 s, Parallel 1.0 s.
- End-to-end in Pi with `doubao-seed-2-1-turbo` and `glm-5.2`, including one search per turn and Chinese queries.
- Invalid `EXA_API_KEY`: the failure is named and Parallel answers 1.5 s later; with the provider pinned, the model receives `websearch failed (exa: web_search_exa error (401): Invalid API key)`.
