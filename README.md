# pi-lite-websearch

A minimal [Pi](https://github.com/badlogic/pi-mono) extension that adds one
compact, keyless `websearch` tool. No SDK, no API key, no MCP server process,
no build step — and a hard budget on how much context one search may consume.

```text
> search the web for the current Node.js LTS version

1. [Node.js — Node.js 24.20.0 (LTS)](https://nodejs.org/en/blog/release/v24.20.0) (2026-08-28)
Node.js 24.20.0 is the current LTS release ...
```

## Why another web search extension?

| | Provider-hosted search | MCP search server | Raw API passthrough | pi-lite-websearch |
|---|---|---|---|---|
| Works on any model | no | yes | yes | yes |
| Works with no API key | provider-dependent | usually not | usually not | yes |
| Extra process or config | no | yes | no | no |
| Output size bounded | provider's choice | provider's choice | provider's choice | 6000 chars by default |
| Failover between backends | n/a | no | no | Exa → Parallel |

The goal is not more data. It is the smallest result that still answers the
question: titles, links, dates, and a truncated excerpt instead of a multi-KB
page dump.

## Install

From a local checkout:

```bash
git clone https://github.com/jinhuang712/pi-lite-websearch.git
cd pi-lite-websearch
pi install -l "$PWD"
```

Or load it for a single run:

```bash
pi -e /absolute/path/to/pi-lite-websearch/src/index.ts
```

Restart Pi after installing. The extension has no runtime dependencies beyond
what Pi already provides.

## Usage

Just ask a question that needs current information:

```text
> what's new in the latest pi release?
> find the official docs for bun's test runner
> search for KLOOK engineering blog posts
```

The model calls `websearch` with a query and, optionally, `numResults` (1–10).
Requests are capped at `PI_WEBSEARCH_MAX_RESULTS` regardless of what the model
asks for.

## Configuration

Everything is environment-based; there is no config file or slash command.

| Variable | Default | Purpose |
|----------|---------|---------|
| `EXA_API_KEY` | unset | Higher Exa rate limits |
| `PARALLEL_API_KEY` | unset | Higher Parallel rate limits |
| `PI_WEBSEARCH_PROVIDER` | `auto` | `exa` or `parallel` to pin one backend; anything else keeps Exa → Parallel failover |
| `PI_WEBSEARCH_MAX_RESULTS` | `5` | Results requested per search (1–10) |
| `PI_WEBSEARCH_MAX_CHARS` | `6000` | Character budget for the whole result (500–50000) |
| `PI_WEBSEARCH_PER_RESULT_CHARS` | `1200` | Character budget per excerpt (200–10000) |
| `PI_WEBSEARCH_TIMEOUT_MS` | `12000` | Per-provider timeout (1000–60000) |

Invalid values fall back to the defaults. None of these settings are required
for search to work.

## How it works

1. `prepareArguments` normalizes whatever the model sent (aliases, numeric
   strings, out-of-range counts) before schema validation, so a weak model does
   not burn a round trip on a fixable argument.
2. The query goes to a keyless MCP endpoint over one JSON-RPC `tools/call`
   POST — Exa first, Parallel as failover. Both accept plain HTTP without a
   session handshake.
3. The response is parsed into structured results rather than forwarded.
4. `format.ts` renders a numbered list under an explicit character budget:
   `[title](url) (date)` plus a truncated excerpt, with omitted results
   reported instead of silently dropped.

Failures name the provider (`websearch failed (exa: HTTP 500; parallel: timed
out)`), and a caller cancel never triggers failover.

## Design

- [GOALS.md](GOALS.md) — what the project is for, with measurable criteria
- [PHILOSOPHY.md](PHILOSOPHY.md) — the clauses every change is judged against
- [DESIGN.md](DESIGN.md) — providers, budgets, failover, decision log
- [AGENTS.md](AGENTS.md) — repository rules for agents
- [GITFLOW.md](GITFLOW.md) — commit conventions

## Development

```bash
npm install
npm test           # node --test, no network
npm run typecheck  # tsc --noEmit
```

Live smoke test:

```bash
pi -p --no-session -nc -nbt -t websearch \
  -e "$PWD/src/index.ts" \
  "Use websearch to find the latest pi release version."
```

## Requirements

- Pi 0.85 or newer
- Node.js 22.19 or newer (Pi's own floor)

## License

MIT
