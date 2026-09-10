# pi-lite-websearch Design

> Established 2026-09-10. Concrete decisions behind the implementation. The
> criteria live in PHILOSOPHY.md; the deliverables and their measures live in
> GOALS.md.

## Overview

One Pi extension, one tool, two keyless search backends, no runtime
dependencies.

```text
model ── websearch(query, numResults) ──▶ prepareArguments
                                              │
                                              ▼
                                     search()  (src/websearch.ts)
                                              │  ordered providers
                        ┌─────────────────────┴─────────────────────┐
                        ▼                                           ▼
                 Exa MCP endpoint                            Parallel MCP endpoint
            POST tools/call web_search_exa              POST tools/call web_search
                        │                                           │
                        └─────────────┬─────────────────────────────┘
                                      ▼
                              provider parser → SearchResult[]
                                      │
                                      ▼
                             formatResults()  (src/format.ts)
                                      │  budgeted, numbered text
                                      ▼
                                  tool result
```

## Repository Layout

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | Pi registration: tool name, schema, description, snippet, TUI call line. No search logic. |
| `src/websearch.ts` | Config resolution, argument normalization, failover, error text. No Pi imports, so it is unit-testable standalone. |
| `src/providers.ts` | MCP transport, provider adapters, response parsing into `SearchResult[]`. |
| `src/format.ts` | Character budgeting and compact rendering. |
| `test/*.test.ts` | Node test runner; no network. |

## Tool Contract

| Field | Value |
|-------|-------|
| Name | `websearch` |
| `promptSnippet` | `Search the web for current facts, docs, news, and prices` |
| Parameters | `query: string` (required), `numResults?: number` (1–10) |
| Output | Plain text: numbered list of `[title](url) (date)` plus a truncated excerpt |
| `details` | `{ query, numResults, provider }` for renderers and debugging |

Deliberate omissions:

- **No enums or unions.** `numResults` is a bounded number; there is no `type`
  or `mode` parameter. Exit OpenCode's `type` / `livecrawl` /
  `contextMaxCharacters` knobs, which were provider feature flags leaking into
  the model's schema. Everything the model sends must change what it gets back.
- **No `promptGuidelines`.** The description already states the purpose; an
  extra system-prompt bullet costs tokens on every request to repeat it.
- **No URL mode.** Fetching is a reserved capability (GOALS.md), not a second
  parameter that half-works.

`prepareArguments` normalizes before schema validation: string args, `q` /
`search_query` / `query_string` / `text` aliases, nested `{text}` objects,
numeric strings for counts, `limit` / `count` / `num_results` / `maxResults`
aliases, and clamping to 1–10. Queries are whitespace-collapsed and capped at
1000 characters. This exists because a validation error costs a model round
trip, and weaker models are exactly who the tool must serve (Clause 4).

## Providers

Both backends speak MCP-over-HTTP: one `tools/call` JSON-RPC POST, no session
handshake, no SDK.

| | Exa | Parallel |
|---|---|---|
| Endpoint | `https://mcp.exa.ai/mcp` | `https://search.parallel.ai/mcp` |
| Tool | `web_search_exa` | `web_search` |
| Arguments | `{ query, numResults }` | `{ objective, search_queries: [query], session_id }` |
| Auth | none; optional `?exaApiKey=` | none; optional `Authorization: Bearer` |
| Response | SSE or JSON; `result.content[].text` in a `Title:/URL:/Highlights:` layout | JSON; `result.content[].text` is a JSON document with `results[]` |
| Role | primary | failover |

Why this pair:

- **Keyless satisfies Clause 2.** Both work on a fresh install. API keys only
  raise rate limits.
- **Independent failure modes satisfy Clause 5.** Different operators,
  different infrastructure; a retry against the same endpoint rarely helps.
- **Shape diversity is contained.** Two parsers behind one `SearchResult[]`
  boundary. Adding a provider touches `providers.ts` only (Clause 7).

OpenCode's `websearch` tool was the prior art. Kept: the keyless MCP transport,
JSON-RPC envelope, SSE-or-JSON tolerance, and the Exa/Parallel pairing. Changed:
structured parsing and budgeting instead of forwarding `result.content[].text`
verbatim.

## Compaction

Raw provider text is evidence of what the provider optimized for -- complete
page extracts, which is not what a model needs first (Clause 1).

Per result, in order:

1. Split Exa's `Title:` blocks (or read Parallel's `results[]`).
2. Keep title, URL, and publish date only when present and meaningful
   (`N/A` is dropped).
3. Drop Exa's `...` chunk separators, trailing spaces, and blank-line runs.
4. Truncate the excerpt to `perResultChars`, preferring a word boundary.
5. Stop adding results when the remaining budget cannot fit a useful excerpt
   (160 characters) and report how many were omitted.

Defaults and worst cases:

| Budget | Default | Range | Effect |
|--------|---------|-------|--------|
| `maxChars` | 6000 | 500–50000 | Soft ceiling for the whole result |
| `perResultChars` | 1200 | 200–10000 | Ceiling for one excerpt |
| `maxResults` | 5 | 1–10 | Requested from the provider |

The configured `maxResults` is also the ceiling for what the model may request
per call, so the context cost of one search cannot be raised by the model.

Measured compaction: the same Exa query returned 20,834 characters of raw text
(5 results) and 5,450 characters after formatting (-73%), while still answering
the question. A default search lands near 1.2–1.6K tokens including its
headers.

## Configuration

Environment only. No config file, no command, no persisted state (Clause 6).

| Variable | Default | Purpose |
|----------|---------|---------|
| `EXA_API_KEY` | unset | Higher Exa rate limits |
| `PARALLEL_API_KEY` | unset | Higher Parallel rate limits |
| `PI_WEBSEARCH_PROVIDER` | `auto` | Force `exa` or `parallel`; anything else means Exa → Parallel failover |
| `PI_WEBSEARCH_MAX_RESULTS` | `5` | Requested result count, clamped 1–10 |
| `PI_WEBSEARCH_MAX_CHARS` | `6000` | Whole-result budget, clamped 500–50000 |
| `PI_WEBSEARCH_PER_RESULT_CHARS` | `1200` | Per-excerpt budget, clamped 200–10000 |
| `PI_WEBSEARCH_TIMEOUT_MS` | `12000` | Per-provider timeout, clamped 1000–60000 |

Invalid values fall back to defaults; none of them can make the tool
unavailable (Clause 2).

## Failover, Errors, and Cancellation

- Providers run in order. The next one starts when the current one throws or
  returns zero results.
- Every failure is recorded as `<provider>: <reason>`; when all fail, the tool
  throws `websearch failed (exa: HTTP 500; parallel: timed out)`. The provider
  name is what makes the message actionable.
- Zero results across healthy providers is not an error: the model gets
  `No search results found for "<query>". Try a different query.`
- Each attempt gets its own `AbortSignal.timeout(config.timeoutMs)` combined
  with Pi's tool-cancellation signal. A caller abort stops the loop
  immediately and is never reported as a provider failure.
- Response bodies over 2 MB are refused before parsing.
- A JSON-RPC `error` payload is surfaced as the provider failure reason, not
  swallowed.
- A tool-level `result.isError: true` payload is a failure too, even though the
  HTTP status is 200. Exa answers a bad API key exactly this way, and treating
  it as content would turn an auth failure into a misleading "no results".
  Error text is reduced to one bounded line before it reaches the model.
- An invalid `EXA_API_KEY` / `PARALLEL_API_KEY` can only cost that provider its
  attempt: the failure is named, failover continues keyless, and the search
  still succeeds. OpenCode's `opencode` / `opencode-go` credentials are model
  inference keys and are rejected by both search backends (verified: Exa 401,
  Parallel 401), so they are deliberately not forwarded.

## Deliberate Non-Engineering

- **No build step.** Pi loads TypeScript through Jiti; a `dist/` artifact would
  be a second source of truth (Clause 6).
- **No npm runtime dependencies.** `typebox` and `@earendil-works/pi-tui` are
  aliases the host already provides.
- **No caching or deduplication.** Neither has shown up in real use; both add
  state.
- **No TUI result renderer.** `renderCall` prints `websearch <query>` so the
  transcript shows the intent; the default result renderer collapses long
  output and expands on demand, which is correct and costs no code.

## Verification

- `npm test` — 25 tests, no network: transport framing (JSON/SSE/error), both
  parsers, compaction budgets, config clamps, argument normalization, failover,
  combined failure, empty results, caller abort.
- `npm run typecheck` — strict TypeScript, no emit.
- Live smoke — real keyless searches through `src/websearch.ts` measured
  1.4–1.6 s and 5.4–5.7 KB per default search.
- End-to-end — Pi print-mode runs with `-nbt -t websearch` on
  `doubao-seed-2-1-turbo` and `glm-5.2` both produced answers with correct
  current facts and source URLs.

## Known Assumptions and Risks

| Assumption | If it breaks | Mitigation |
|------------|--------------|------------|
| Exa's `Title:/URL:/Highlights:` layout is stable | Results parse as empty | Parallel failover still answers; parser fixtures make the drift visible in tests |
| Keyless MCP endpoints stay keyless | Zero-config search fails | API-key env vars are already supported; a third adapter fits behind the same boundary |
| Parallel's free tier tolerates a per-process `session_id` | Rate-limited failover | Failover is optional; Exa alone remains the default path |
| Provider excerpts contain the answer | Model needs a follow-up search | `PI_WEBSEARCH_PER_RESULT_CHARS` raises the budget without a code change |

## Decision Log

| Decision | Alternatives rejected | Clauses |
|----------|-----------------------|---------|
| MCP-over-HTTP transport to keyless endpoints | Hosted provider search (model-dependent, opaque); Exa REST (requires a key); MCP server process (extra runtime); DuckDuckGo HTML scraping (fragile, ToS) | 2, 5, 6 |
| Structured compaction with a budget | Forward provider text verbatim (21 KB per search); re-rank or summarize with another model call (latency, cost, unverifiable judgement) | 1, 3 |
| Two providers, ordered failover | Single provider (one outage kills the tool); racing both (double load, free-tier burn) | 3, 5 |
| `websearch` as the tool name | `web_search` (collides conceptually with provider-hosted tools of the same name) | 4 |
| Tolerant argument normalization | Strict schema (validation round trip for weak models); no normalization (failed calls) | 4 |
| No `webfetch` in v0.1 | Ship both (two tools' context cost, two capability surfaces to verify) | 1, 7 |
