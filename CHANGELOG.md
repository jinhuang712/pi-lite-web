# Changelog

All notable changes to `pid-lite-web` are documented here.

## [Unreleased]

### Changed

- **Renamed to `pid-lite-web`.** The extension grew a half that only a graphical host loads, and the
  prefix says so. Nothing else moves: the tools are still `search` and `fetch`, the environment
  variables are still `PI_WEB_*` — they name the host that runs the extension, not the extension —
  and there is no configuration file to migrate, because there never was one. A checkout installed
  by path keeps working once the path is updated; `pi install` from GitHub follows the repository's
  own redirect.

### Added

- **A graphical host gets the same two rows, drawn by this extension.** `renderCall` returns a
  pi-tui line and only a terminal can mount one, so the extension ships a second half — `src/ui.tsx`,
  declared as `"pid": { "ui": … }` — which draws `search` and `fetch` out of the host's own row
  frame. Both halves read the same `details` the tool already returns, so the window carries the two
  facts the terminal line has no room for: the backend that answered, and how much came back. The
  backend is a tinted pill and the counts are plain, which is what makes the row read differently
  from the host's own `read` and `bash` above it — those go one place and always the same place, so
  they have nothing to mark. Nothing is guessed by the host: one that does not load the second half
  draws its own generic row.
- `npm run typecheck` now covers the desktop half, against a local mirror of the host's types
  (`src/pid-ui.d.ts`). The host remains the source of truth; the mirror only catches a typo here.

## [0.2.0] - 2026-09-11

The extension is now `pid-lite-web` and ships two tools. Upgrading from
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
