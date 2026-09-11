# 🌐 pi-lite-web

Two compact, keyless web tools for [Pi](https://pi.dev): `search` and `fetch`. No SDK, no API key, no server process, no build step, and a hard budget on how much context one call may consume.

```text
> what changed in the latest pi release?

search pi coding agent changelog
1. [Changelog](https://pi.dev/news/releases)
## Pi 0.84.4
New version of pi. Download from npm or view release on GitHub.
…

fetch https://pi.dev/news/releases
[Changelog](https://pi.dev/news/releases)

## Pi 0.84.4
…
```

## 🤔 Why

| | Provider-hosted search | MCP server | Raw API passthrough | pi-lite-web |
|---|---|---|---|---|
| Works on any model | ❌ | ✅ | ✅ | ✅ |
| Works with no API key | ⚠️ provider-dependent | ⚠️ usually not | ⚠️ usually not | ✅ |
| No extra process or config | ✅ | ❌ | ✅ | ✅ |
| Output size bounded | ⚠️ provider's choice | ⚠️ provider's choice | ⚠️ provider's choice | ✅ search 6000 · fetch 8000 chars |
| Failover between backends | ➖ | ❌ | ❌ | ✅ Exa → Parallel |

✅ yes · ❌ no · ⚠️ depends · ➖ not applicable

The goal is the smallest result that still answers the question. A search returns titles, links, dates and a short excerpt. A fetch returns one page's body, cut at a budget that says so when it cuts.

## 📦 Install

```bash
pi install git:github.com/jinhuang712/pi-lite-web
```

From a checkout, or for one run without installing:

```bash
pi install -l /path/to/pi-lite-web
pi -e /path/to/pi-lite-web/src/index.ts
```

Restart Pi after installing. Nothing is written to disk.

## 🚀 Tools

### `search`

| Parameter | Type | Notes |
|---|---|---|
| `query` | string | Keywords or a natural-language description of the page |
| `numResults` | number, optional | 1–10, default 5, capped at `PI_WEB_SEARCH_RESULTS` |

```text
1. [Title](https://example.com/page) (2026-08-28)
Excerpt, truncated at a word boundary …

2. [Another](https://example.com/other)
…

(+2 more results omitted)
```

### `fetch`

| Parameter | Type | Notes |
|---|---|---|
| `url` | string | Full http(s) URL; a missing scheme becomes `https://` |
| `maxChars` | number, optional | Default 8000, capped at `PI_WEB_FETCH_CHARS` |

```text
[Page title](https://example.com/page)

Page body as markdown-ish text …

(truncated at 8000 characters)
```

Both tools accept sloppy arguments from weaker models: `q` / `search_query` / `link` / `href` aliases, numeric strings, a bare string instead of an object. Normalization happens before schema validation so no round trip is wasted.

## ⚙️ Configuration

Environment only. Every variable has a working default; blank or invalid values fall back to it. A fresh install with none of them set works.

| Variable | Default | Purpose |
|---|---|---|
| `PI_WEB_PROVIDER` | auto | `exa` or `parallel` pins one backend; anything else keeps Exa → Parallel failover |
| `PI_WEB_TIMEOUT_MS` | `12000` | Per-provider timeout (1000–60000) |
| `PI_WEB_SEARCH_RESULTS` | `5` | Results per search and the ceiling the model may request (1–10) |
| `PI_WEB_SEARCH_CHARS` | `6000` | Budget for one whole search result (500–50000) |
| `PI_WEB_SEARCH_RESULT_CHARS` | `1200` | Budget for one excerpt (200–10000) |
| `PI_WEB_FETCH_CHARS` | `8000` | Budget for one fetched page and the ceiling the model may request (500–50000) |
| `EXA_API_KEY` | unset | Higher Exa rate limits |
| `PARALLEL_API_KEY` | unset | Higher Parallel rate limits |

## 🧩 How it works

Both backends expose an MCP endpoint that answers one `tools/call` JSON-RPC POST over plain HTTP, with no session handshake. That is the entire transport.

| | Exa | Parallel |
|---|---|---|
| search | `web_search_exa` | `web_search` |
| fetch | `web_fetch_exa` | `web_fetch` with `full_content` |
| auth | none, optional `?exaApiKey=` | none, optional bearer token |

Providers run in order. The next one runs when the current one throws or answers with nothing. Failures name the provider, `search failed (exa: HTTP 500; parallel: timed out)`, and a cancel from Pi never triggers failover.

When [pi-briefly](https://github.com/jinhuang712/pi-briefly) is installed and terse mode is on, both call lines are handed to it through the row decorator hub. Names, schemas and execution stay here.

## 🩹 Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `search failed (exa: … 401: Invalid API key)` | `EXA_API_KEY` is set but wrong | Unset it, keyless still works, or use a valid Exa key |
| `No search results found for "…"` | The provider answered with nothing | Rephrase; describing the page works better than bare keywords |
| `Nothing readable at https://…` | The page is empty, blocked, or behind a login | Try another URL for the same content |
| `… failed (exa: timed out; parallel: timed out)` | Both backends unreachable or slow | Check connectivity or raise `PI_WEB_TIMEOUT_MS` |
| Output is cut short | The character budget | Raise `PI_WEB_SEARCH_RESULT_CHARS` / `PI_WEB_FETCH_CHARS`, or pass `maxChars` |
| Only one backend is used | `PI_WEB_PROVIDER` is pinned | Unset it |

## 🛠️ Development

```bash
npm install
npm test           # node --test, no network
npm run typecheck  # tsc --noEmit
```

Live smoke:

```bash
pi -p --no-session -nc -nbt -t search,fetch -e "$PWD/src/index.ts" \
  "Use search to find the pi changelog, then fetch it and name the newest version."
```

- [DESIGN.md](DESIGN.md) — principles, budgets, providers, decision log
- [AGENTS.md](AGENTS.md) — rules for agents changing this repository
- [GITFLOW.md](GITFLOW.md) — commit conventions
- [CHANGELOG.md](CHANGELOG.md)

## 📋 Requirements

- Pi 0.85 or newer
- Node.js 22.19 or newer

## 📄 License

[MIT](LICENSE)
