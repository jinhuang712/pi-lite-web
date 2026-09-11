# AGENTS.md

## Project

`pi-lite-web` is a Pi extension that adds two compact, keyless tools: `search`
and `fetch`. Read `DESIGN.md` before changing behavior; it holds the
principles, budgets, provider contracts and the decision log. `README.md` is
the user manual. Entry point: `src/index.ts`.

## Rules

1. **Two tools, one job each.** `search` returns results; `fetch` returns one
   page. Re-ranking, query rewriting, crawling, caching and HTML parsing on this
   side of the wire are out of scope.
2. **Budget every output.** No code path returns unbounded provider text to
   the model, error messages included. Truncation is always visible.
3. **Zero-config keeps working.** A fresh install with no environment variables
   works. Keys and knobs adjust depth, never availability.
4. **No runtime dependencies, build steps, or disk state.** `typebox` and the
   `@earendil-works/*` imports are host-provided. Anything else needs a
   decision recorded in `DESIGN.md` first.
5. **Model-agnostic.** Plain schemas, plain text, tolerant argument
   normalization. No enums, unions, or provider-specific constructs.
6. **Failover, never retry.** One ordered pass, failures named by provider, a
   caller abort is not a failure. The loop lives in `mcp.ts` and is shared.
7. **Keep `search.ts`, `fetch.ts`, `mcp.ts`, `config.ts` free of Pi imports.**
   `index.ts` is the only module that knows Pi exists.

## Layout

| Path | Owns |
|------|------|
| `src/index.ts` | Names, schemas, descriptions, call lines, pi-briefly handshake |
| `src/config.ts` | Environment resolution and clamps, shared argument helpers |
| `src/mcp.ts` | Transport, response framing, failover, text helpers |
| `src/search.ts` | Search behavior: arguments, provider calls, parsers, rendering |
| `src/fetch.ts` | Fetch behavior: arguments, provider calls, parsers, rendering |
| `src/row-decoration.ts` | Optional row handover to pi-briefly |

TypeScript is strict. Local imports use explicit `.ts` extensions, matching
the host's Jiti resolution. Provider layouts are parsed, not trusted: when a
provider changes shape, add a fixture to the matching test file and keep a
fallback, rather than widening the parser speculatively.

## Commands

```bash
npm test           # node --test, no network
npm run typecheck  # tsc --noEmit
```

Live smoke is manual:

```bash
pi -p --no-session -nc -nbt -t search,fetch -e "$PWD/src/index.ts" "<prompt>"
```

## Testing

- Every behavior change lands with a test that fails without it.
- Tests never touch the network; inject a fake `Fetcher`.
- Budgets are pinned by assertions on length or content.
- One test file per source module: `mcp`, `search`, `fetch`, `index`.

## Boundaries

- Do not modify Pi or import from other extensions. pi-briefly is reached only
  through the global symbol in `row-decoration.ts`, and its absence must leave
  the registration unchanged.
- Do not add a config UI, settings file, or session cache without a
  `DESIGN.md` decision.
- `README.md`, `DESIGN.md`, `CHANGELOG.md` and tests move with behavior. A
  change with stale docs is unfinished.

## Commits

Follow `GITFLOW.md`: single trunk, small verifiable commits, Chinese subject
with a conventional type prefix.
