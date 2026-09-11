# pi-lite-web Design

> Established 2026-09-10, revised 2026-09-11 when `fetch` shipped and the
> extension was renamed from pi-lite-websearch. Principles, goals, concrete
> decisions and the decision log live here; the README is the user manual.

## Proposition

> A web tool is a context transformer, not a data pipe.

The provider moves bytes; this extension decides what the model pays to read.
Output is judged per token, not per response. Every returned character is a
deliberate purchase, coverage is the provider's problem, and the default answer
to "should we return more?" is no.

## Principles

Every change is walked through these in order. A hit means the change takes a
different shape or does not ship. Numbers are permanent so decisions can cite them.

| # | Principle | In practice |
|---|-----------|-------------|
| 1 | **The model pays for every character.** | Every output has a documented default budget and a hard ceiling, error text included. A truncated result says so. |
| 2 | **Zero config must answer the question.** | No credential on the default path. Deleting every environment variable changes nothing essential. |
| 3 | **Speed is a feature; the worst case is bounded.** | One request per call on the happy path, short timeouts, one bounded failover attempt, no retry loops. |
| 4 | **No model left behind.** | Plain schemas (no enums, no unions), plain-text output, tolerant argument normalization, instructions in the tool description rather than the system prompt. |
| 5 | **Failover beats retry.** | Providers are ordered; the next runs only after the previous fails or answers with nothing. Failures name the provider. Caller cancellation is not a failure. |
| 6 | **Smallness produces reliability.** | Only host-provided imports, no build step, no disk state, the fewest modules that can be tested independently. |
| 7 | **Tighten scope, reserve capability.** | Two tools, each doing one thing. Provider specifics stay behind the adapter boundary; adding one touches no budget, format, or registration code. |

## Goals

| # | Goal | How it is checked |
|---|------|-------------------|
| G1 | Zero-config: fresh install, no env vars, no key, both tools work | Live smoke with a stripped environment (`env -i`) |
| G2 | Small context cost: search ≤ 6000 chars, fetch ≤ 8000 chars by default; payloads compacted, never forwarded | Unit tests pin the budgets; live search measured 20.8 KB raw → 5.5 KB rendered |
| G3 | Fast: typical call 0.3–2 s, worst case 12 s per provider | Live smoke; `AbortSignal.timeout` at the transport |
| G4 | Model-agnostic | Verified end-to-end on `doubao-seed-2-1-turbo`, `glm-5.2`, and Pi's default model |
| G5 | Small footprint: six source files, zero runtime dependencies, no build | `package.json` has no `dependencies`; Pi loads `src/` through Jiti |
| G6 | Degrades, does not fail: one provider outage does not kill either tool | Failover unit tests with an injected failing fetch |

Non-goals: re-ranking, deduplication, query rewriting, caching, a config UI,
providers that require an account, and any HTML parsing on this side of the
wire. Reserved (not built, not blocked): multi-URL fetch in one call, a
session-scoped cache if repeated identical calls ever show up in transcripts.

## Architecture

```text
model ── search(query, numResults) ──┐         ┌── fetch(url, maxChars) ── model
                                     ▼         ▼
                       prepareSearchArguments  prepareFetchArguments   (aliases, clamps)
                                     ▼         ▼
                            search.ts          fetch.ts                (per-tool logic + parsers)
                                     └────┬────┘
                                          ▼
                                 mcp.ts failover()                     (ordered providers, timeouts)
                                          ▼
                                 mcp.ts callMcp()                      (one JSON-RPC tools/call POST)
                              ┌───────────┴───────────┐
                              ▼                       ▼
                     https://mcp.exa.ai/mcp   https://search.parallel.ai/mcp
```

| Path | Responsibility |
|------|----------------|
| `src/index.ts` | Registration only: names, schemas, descriptions, call lines, pi-briefly handshake |
| `src/config.ts` | Environment resolution, clamps, shared argument helpers |
| `src/mcp.ts` | Transport, response framing, failover, text helpers shared by both tools |
| `src/search.ts` | Search arguments, provider calls, parsers, budgeted list rendering |
| `src/fetch.ts` | Fetch arguments, provider calls, parsers, budgeted page rendering |
| `src/row-decoration.ts` | Optional handover of the call line to pi-briefly |
| `test/*.test.ts` | Node test runner, no network, fake `Fetcher` injection |

`search.ts`, `fetch.ts`, `mcp.ts` and `config.ts` import nothing from Pi or
TypeBox, so the whole behavior is testable without the host.

## Tool Contracts

| | `search` | `fetch` |
|---|---|---|
| Parameters | `query: string`, `numResults?: 1–10` | `url: string`, `maxChars?: 1–50000` |
| Model-side ceiling | `PI_WEB_SEARCH_RESULTS` | `PI_WEB_FETCH_CHARS` |
| Output | Numbered `[title](url) (date)` + excerpt, `(+N more results omitted)` | `[title](url)`, body, `(truncated at N characters)` |
| Empty answer | `No search results found for "…"` | `Nothing readable at …` |
| `details` | `{ query, numResults, provider }` | `{ url, chars, truncated, provider }` |

Deliberate omissions: no `type` / `mode` / `format` parameters (provider feature
flags leaking into the schema), no `promptGuidelines` (the description already
states the purpose; a system-prompt bullet costs tokens on every turn), no
multi-URL fetch (one page per call keeps the budget legible).

Argument normalization runs before schema validation because a validation
error costs a model round trip, and weaker models are exactly who this must
serve (Principle 4). Search: `q` / `search_query` / `query_string` / `text`,
nested `{text}`, `limit` / `count` / `num_results` / `maxResults`, numeric
strings, whitespace collapse, 1000-character cap. Fetch: `link` / `href` /
`uri`, `<…>` wrapping, a missing scheme becomes `https://`, `max_chars` /
`maxCharacters` / `limit`.

## Providers

| | Exa | Parallel |
|---|---|---|
| Endpoint | `https://mcp.exa.ai/mcp` | `https://search.parallel.ai/mcp` |
| Search call | `web_search_exa { query, numResults }` | `web_search { objective, search_queries, session_id }` |
| Search reply | Text, `Title:/URL:/Published:/Highlights:` blocks | JSON, `results[] { title, url, publish_date, excerpts[] }` |
| Fetch call | `web_fetch_exa { urls: [url], maxCharacters }` | `web_fetch { urls: [url], full_content: true, session_id }` |
| Fetch reply | Markdown: `# Title`, `URL:` line, body with the title repeated | JSON, `results[] { title, url, full_content, excerpts[] }`, `errors[]` |
| Auth | none; optional `?exaApiKey=` | none; optional `Authorization: Bearer` |
| Role | primary | failover |

Both replies arrive as either plain JSON or SSE `data:` lines; `readMcpText`
accepts both. A tool-level `result.isError: true` is a failure even at HTTP 200,
because Exa answers a bad key that way and treating it as content would turn a
401 into "no results". Error text is cut to one 300-character line before it
reaches the model. Bodies over 2 MB are refused before parsing.

Parallel's `full_content` is requested and cut locally; Exa is asked for the
budget plus 200 characters so a word-boundary cut still lands inside it.

## Budgets

| Budget | Default | Range | Applies to |
|--------|---------|-------|------------|
| `search.maxResults` | 5 | 1–10 | Results requested, and the most the model may ask for |
| `search.maxChars` | 6000 | 500–50000 | The whole rendered list |
| `search.perResultChars` | 1200 | 200–10000 | One excerpt |
| `fetch.maxChars` | 8000 | 500–50000 | One page, and the most the model may ask for |
| `timeoutMs` | 12000 | 1000–60000 | One provider attempt |

Search stops adding results when fewer than 160 characters of budget remain and
reports the omission. Fetch cuts at a word boundary and appends a truncation
line. Measured: a default search renders in 1.2–1.6K tokens; a default fetch
in at most ~2K.

## Verification

- `npm test`: 38 tests, no network. Transport framing, failover, both parsers
  for both tools, budgets, config clamps, argument normalization, registration,
  the pi-briefly handshake.
- `npm run typecheck`: strict TypeScript, no emit.
- Live, keyless, stripped environment on 2026-09-11: Exa search 3 results in
  2.0 s (1792 chars); Exa fetch of a GitHub page in 0.26 s, truncated at 2000;
  Parallel fetch of example.com in 0.31 s.
- End-to-end in Pi print mode: the model chained `search` then `fetch` and
  named the newest release on the page it read.

## Assumptions and Risks

| Assumption | If it breaks | Mitigation |
|------------|--------------|------------|
| Exa's text layouts stay stable | Results parse as empty, fetch body keeps a stray header line | Parallel answers; parser fixtures in tests make drift visible |
| Keyless endpoints stay keyless | Zero-config fails | Key env vars already work; a third adapter fits behind `mcp.ts` |
| Parallel's free tier tolerates a per-process `session_id` | Rate-limited failover | Exa alone remains the default path |
| Provider extraction is good enough | Model needs another fetch | `maxChars` and `PI_WEB_FETCH_CHARS` raise the budget without a code change |

## Decision Log

| Decision | Alternatives rejected | Principles |
|----------|-----------------------|------------|
| MCP-over-HTTP to keyless endpoints | Hosted provider search (model-dependent, opaque); Exa REST (needs a key); MCP server process; HTML scraping (fragile, ToS) | 2, 5, 6 |
| Fetch through the same MCP endpoints | Direct HTTP + turndown / htmlparser2 as in OpenCode (two runtime dependencies, an HTML pipeline to maintain, no failover) | 5, 6, 7 |
| Structured compaction under a budget | Forward provider text verbatim (21 KB per search); summarize with another model call (latency, cost) | 1, 3 |
| Two providers, ordered failover | Single provider (one outage kills both tools); racing both (double load, free-tier burn) | 3, 5 |
| Two tools named `search` and `fetch` | One `web` tool with a `mode` enum (an enum weak models fumble, two budgets under one name); `websearch` / `webfetch` (longer, the prefix says nothing the description does not) | 4, 7 |
| Shared `failover()` in `mcp.ts` | A loop per tool (two copies of the abort and error-naming rules to keep aligned) | 6 |
| Tolerant argument normalization | Strict schema (a round trip for weak models); none (failed calls) | 4 |
| One URL per fetch | Batch `urls[]` as the providers allow (one budget spread over N pages is illegible to the model) | 1, 7 |
| Env prefix `PI_WEB_*` | Keep `PI_WEBSEARCH_*` (would misname the fetch budgets); per-tool prefixes (two ways to pin a provider) | 6 |
| Hand call lines to pi-briefly when present | Own the rows unconditionally (a duplicated terse renderer); a renderer-only Pi hook (none exists) | 5 |
| Merge GOALS and PHILOSOPHY into this file | Keep three documents (about 750 lines of prose for 650 lines of code, cross-referenced by clause number) | 6 |
