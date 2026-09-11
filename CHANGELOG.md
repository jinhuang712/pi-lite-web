# Changelog

All notable changes to `pi-lite-web` are documented here.

## [0.2.0] - 2026-09-11

The extension is now `pi-lite-web` and ships two tools. Upgrading from
`pi-lite-websearch` means reinstalling under the new name and renaming any
`PI_WEBSEARCH_*` environment variables to their `PI_WEB_*` equivalents below.

### Added

- The `fetch` tool: one URL in, one page out as `[title](url)` plus the body,
  cut at a character budget with a visible `(truncated at N characters)` line.
  Exa `web_fetch_exa` first, Parallel `web_fetch` as failover, both keyless and
  over the same MCP-over-HTTP transport. `details` carries `url`, `chars`,
  `truncated`, `provider`.
- Fetch argument normalization: `link` / `href` / `uri` aliases, `<…>`
  wrapping, a missing scheme becomes `https://`, `max_chars` /
  `maxCharacters` / `limit` for the budget.
- `PI_WEB_FETCH_CHARS` (default 8000) as the fetch budget and the ceiling for
  what the model may request per call.

### Changed

- `websearch` is now `search`. Parameters, output and behavior are unchanged;
  the description points the model at `fetch` for reading a result in full.
- Environment variables share the `PI_WEB_*` prefix: `PI_WEB_PROVIDER`,
  `PI_WEB_TIMEOUT_MS`, `PI_WEB_SEARCH_RESULTS`, `PI_WEB_SEARCH_CHARS`,
  `PI_WEB_SEARCH_RESULT_CHARS`, `PI_WEB_FETCH_CHARS`. `EXA_API_KEY` and
  `PARALLEL_API_KEY` are unchanged.
- Error and status text names the tool: `search failed (…)`, `fetch failed (…)`,
  `search cancelled`, `fetch cancelled`.
- Source reorganized into `config.ts`, `mcp.ts`, `search.ts`, `fetch.ts`, with
  one shared `failover()` instead of a loop per tool. `websearch.ts`,
  `providers.ts` and `format.ts` are gone.
- Both call lines are handed to pi-briefly through the row decorator hub when
  it is installed; the handshake now covers every registered tool.
- `GOALS.md` and `PHILOSOPHY.md` are folded into `DESIGN.md`; the README and
  `AGENTS.md` are rewritten for two tools.

### Verified

- `npm test`: 38 tests, no network.
- `npm run typecheck`: strict TypeScript, no emit.
- Keyless, stripped environment: Exa search 3 results in 2.0 s; Exa fetch
  0.26 s; Parallel fetch 0.31 s.
- Pi print mode: the model chained `search` then `fetch` and named the newest
  release listed on the page it read.

## [0.1.1] - 2026-09-10

### Added

- The call line can be handed over to [pi-briefly](https://github.com/jinhuang712/pi-briefly)
  through the row decorator hub (`Symbol.for("pi.toolRowDecorator.v1")`). The
  handshake re-applies on `session_start` and on `hub.subscribe(...)`, so the
  row follows the `/briefly` switch without a restart.

## [0.1.0] - 2026-09-10

### Added

- The `websearch` tool: one keyless search per call, rendered as a numbered
  list of `[title](url) (date)` plus a truncated excerpt.
- Exa as the primary backend and Parallel as automatic failover, both over
  MCP-over-HTTP. No SDK, no API key, no MCP server process.
- Output budgets `maxChars` 6000, `perResultChars` 1200, `maxResults` 5,
  adjustable by environment variable.
- Argument normalization for weak models, tolerant JSON / SSE response
  handling, a 2 MB body ceiling.

### Fixed

- An MCP `result.isError: true` payload is a provider failure, not an empty
  result. Exa answers an invalid API key with HTTP 200 and `isError`.
- Provider error text is reduced to one bounded line.
- Blank environment variables fall back to defaults instead of clamping to the
  minimum.
