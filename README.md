# 🔍 pi-lite-websearch

A minimal [Pi](https://pi.dev) extension that adds one compact, keyless `websearch` tool. No SDK, no API key, no MCP server process, no build step — and a hard budget on how much context one search may consume.

```text
> what changed in the latest pi release?

1. [packages/coding-agent/CHANGELOG.md](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/CHANGELOG.md) (2026-08-28)
### New Features
- **Terminal capability overrides** — Override detected terminal hyperlink, image, and truecolor support…
```

## 🤔 Why another web search extension?

| | Provider-hosted search | MCP search server | Raw API passthrough | pi-lite-websearch |
|---|---|---|---|---|
| Works on any model | ❌ | ✅ | ✅ | ✅ |
| Works with no API key | ⚠️ provider-dependent | ⚠️ usually not | ⚠️ usually not | **✅** |
| No extra process or config | ✅ | ❌ | ✅ | ✅ |
| Output size bounded | ⚠️ provider's choice | ⚠️ provider's choice | ⚠️ provider's choice | **✅ 6000 chars by default** |
| Failover between backends | ➖ n/a | ❌ | ❌ | **✅ Exa → Parallel** |

✅ yes · ❌ no · ⚠️ depends on the provider · ➖ not applicable

The goal is not more data. It is the smallest result that still answers the question: titles, links, dates, and a truncated excerpt instead of a multi-KB page dump.

## 📦 Install

As a Pi package (recommended):

```bash
pi install git:github.com/jinhuang712/pi-lite-websearch
```

From a local checkout:

```bash
git clone https://github.com/jinhuang712/pi-lite-websearch.git
cd pi-lite-websearch
pi install -l "$PWD"
```

Or load it for a single run without installing:

```bash
pi -e /absolute/path/to/pi-lite-websearch/src/index.ts
```

🔄 Restart Pi after installing. The extension has no runtime dependencies beyond what Pi already provides, and it writes nothing to disk.

## 🚀 Usage

Ask a question that needs current information:

```text
> what's new in the latest pi release?
> find the official docs for bun's test runner
> 深圳到香港高铁的时刻表在哪看
```

The model calls `websearch` with a query and, optionally, `numResults` (1–10). Requests are capped at `PI_WEBSEARCH_MAX_RESULTS` regardless of what the model asks for, so one search cannot grow the context on its own.

### Result format

```text
1. [Title of the page](https://example.com/page) (2026-08-28)
Excerpt from the page, truncated at the per-result character budget …

2. [Another result](https://example.com/other)
…
```

- Titles link to the source; publish dates are included only when the provider reports a real one.
- Excerpts are truncated at a word boundary and marked with `…`.
- When the total budget cannot fit another useful excerpt, the tail says `(+N more results omitted)` instead of silently dropping them.

## ⚙️ Configuration

Everything is environment-based; there is no config file, slash command, or persisted state.

| Variable | Default | Purpose |
|----------|---------|---------|
| `EXA_API_KEY` | unset | Higher Exa rate limits (optional) |
| `PARALLEL_API_KEY` | unset | Higher Parallel rate limits (optional) |
| `PI_WEBSEARCH_PROVIDER` | `auto` | `exa` or `parallel` to pin one backend; anything else keeps Exa → Parallel failover |
| `PI_WEBSEARCH_MAX_RESULTS` | `5` | Results requested per search (1–10) |
| `PI_WEBSEARCH_MAX_CHARS` | `6000` | Character budget for the whole result (500–50000) |
| `PI_WEBSEARCH_PER_RESULT_CHARS` | `1200` | Character budget per excerpt (200–10000) |
| `PI_WEBSEARCH_TIMEOUT_MS` | `12000` | Per-provider timeout (1000–60000) |

💡 Invalid or blank values fall back to the defaults. A key is never required: a fresh install with no environment variables searches successfully.

## 🧩 How it works

1. `prepareArguments` normalizes whatever the model sent — aliases, numeric strings, out-of-range counts — before schema validation, so a weak model does not burn a round trip on a fixable argument.
2. The query goes to a keyless MCP endpoint over a single JSON-RPC `tools/call` POST: Exa first, Parallel as failover. Both answer plain HTTP without a session handshake.
3. The response is parsed into structured results (`Title/URL/Highlights` text for Exa, JSON for Parallel) rather than forwarded verbatim.
4. `format.ts` renders the numbered list under an explicit character budget.
5. The call line — `websearch pi coding agent` — is this extension's, unless [pi-briefly](https://github.com/jinhuang712/pi-briefly) is installed and terse mode is on: then the row is handed over through the row decorator hub and drawn as one line. Execution, schema and description never change hands.

Failures name the provider — `websearch failed (exa: HTTP 500; parallel: timed out)` — and a caller cancel never triggers failover.

## 🩹 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `websearch failed (exa: … 401: Invalid API key)` | `EXA_API_KEY` is set but wrong. The key is Exa's, not another provider's. | Unset it (keyless still works) or use a valid Exa key. |
| `No search results found for "…"` | The provider answered, but found nothing. | Rephrase the query; a natural-language description of the page you want works better than bare keywords. |
| `websearch failed (exa: timed out; parallel: timed out)` | Both backends are unreachable or slow. | Check connectivity, or raise `PI_WEBSEARCH_TIMEOUT_MS`. |
| Results are too short | The character budget truncated them. | Raise `PI_WEBSEARCH_PER_RESULT_CHARS` / `PI_WEBSEARCH_MAX_CHARS`. |
| Only one backend is used | `PI_WEBSEARCH_PROVIDER` is pinned. | Unset it to restore failover. |

## ✅ Verified

- `npm test` — 37 tests, no network (fake `Fetcher` injection).
- `npm run typecheck` — strict TypeScript, no emit.
- Zero-config search with a stripped environment (`env -i`, no keys at all): 3 results in 1.7 s.
- Compaction: the same Exa query returned 20,834 characters raw and 5,450 characters rendered (−73%).
- Latency: Exa 1.4–1.6 s, Parallel 1.0 s.
- End-to-end in Pi with `doubao-seed-2-1-turbo` and `glm-5.2`, including multi-search turns and Chinese queries.
- An invalid `EXA_API_KEY` costs that provider its attempt only: the failure is named and Parallel answers 1.5 s later.

## 📐 Design

- [GOALS.md](GOALS.md) — what the project is for, with measurable criteria
- [PHILOSOPHY.md](PHILOSOPHY.md) — the clauses every change is judged against
- [DESIGN.md](DESIGN.md) — providers, budgets, failover, decision log
- [AGENTS.md](AGENTS.md) — repository rules for agents
- [GITFLOW.md](GITFLOW.md) — commit conventions

## 🛠️ Development

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

## 📋 Requirements

- Pi 0.85 or newer
- Node.js 22.19 or newer (Pi's own floor)

## 📄 License

[MIT](LICENSE) · [Changelog](CHANGELOG.md)
