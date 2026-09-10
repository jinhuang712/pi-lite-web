# pi-lite-websearch Goals

> Established 2026-09-10. What this project is for, what it refuses to do, and
> how each claim is checked.

## Problem

Pi has no web search of its own. When a model needs a fact beyond its knowledge
cutoff, the options today are:

- **Provider-hosted search** (Anthropic / OpenAI / Google server-side tools).
  Not offered by every provider, unavailable for most open-weight models, and
  opaque: the search never reaches the session, so it cannot be inspected,
  logged, or debugged.
- **MCP search servers**. Require a separate process, an API key, and a client
  config before the first search works.
- **Raw API passthrough**. Returns the provider payload unchanged. Exa returned
  ~21 KB for five results in testing, roughly 5K tokens for one call.

None of these satisfies the actual requirement: a search that works on a fresh
install, costs little context, answers fast, and behaves the same on every
model.

## Goals

| # | Goal | How it is checked |
|---|------|-------------------|
| G1 | **Zero-config.** Fresh install, no env vars, no API key: the first search returns usable results. | Live smoke against the keyless endpoints; `EXA_API_KEY` / `PARALLEL_API_KEY` are optional depth, not prerequisites. |
| G2 | **Small context cost.** Tool definition stays under ~200 tokens; one default search renders at most 6000 characters (~1.5K tokens); upstream payloads are compacted, not forwarded. | Unit tests pin the budget; live measurement compacted 20.8 KB of raw Exa text to 5.5 KB (-73%). |
| G3 | **Fast.** Typical search completes in ~1.5 s; worst case is bounded and visible. | Live smoke measured 1.4–1.6 s for the keyless Exa endpoint. Hard 12 s timeout, one failover attempt, no retry loops. |
| G4 | **Model-agnostic.** Works identically on frontier and small models. | Plain TypeBox schema (no enums or unions), plain-text output, tolerant argument normalization. Verified end-to-end with `doubao-seed-2-1-turbo` and `glm-5.2`. |
| G5 | **Small footprint.** No runtime dependencies, no build step, no background process, no state on disk. | Only host-provided imports (`typebox`, `@earendil-works/pi-tui`); four source files loaded directly by Pi's Jiti runtime. |
| G6 | **Degrades, does not fail.** One provider outage should not kill the search. | Exa → Parallel automatic failover, covered by a unit test with an injected failing fetch. |

## Non-Goals

- **Page fetching and crawling.** A search returns search results. Reading a
  specific URL is a separate capability (`webfetch`), reserved below.
- **Result re-ranking, deduplication, or query rewriting.** The provider's
  relevance order is used as-is; second-guessing it costs latency and adds a
  judgement layer this project cannot verify.
- **Caching.** A search is a few seconds and a handful of kilobytes; a cache
  adds state, invalidation rules, and stale answers.
- **Configuration UI.** Environment variables are the whole configuration
  surface. There is no `/websearch` menu.
- **Providers that require an account.** One keyless path must always work.
- **Intercepting provider-hosted search.** If the active model already has
  server-side search, this tool simply is not used.

## Reserved Capabilities

Reserved means "not built now, and nothing in the current design blocks it"
(see PHILOSOPHY Clause 7):

- A `webfetch` tool reusing Exa's `web_fetch_exa` endpoint, sharing the same
  transport and budget code.
- Multi-query fan-out in a single tool call.
- A session-scoped result cache, if repeated identical searches ever show up in
  real transcripts.

## Definition of Done for v0.1

1. `npm test` passes with no network access.
2. `npm run typecheck` passes.
3. Live smoke succeeds with at least two different model families.
4. A default search stays inside the documented character budget.
5. README, DESIGN, PHILOSOPHY, GOALS, AGENTS, and GITFLOW describe what was
   actually built, not what was planned.
