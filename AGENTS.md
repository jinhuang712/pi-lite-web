# AGENTS.md

## Project

`pi-lite-websearch` is a Pi extension that adds one compact, keyless
`websearch` tool.

Read before changing behavior:

- `GOALS.md` — what the project is for and how claims are checked
- `PHILOSOPHY.md` — the criteria every change is judged against
- `DESIGN.md` — the concrete design, budgets, providers, and decision log

Entry point: `src/index.ts`.

## Non-Negotiable Design Rules

1. **Search only.**
   Return search results. Fetching URLs, crawling, query rewriting, and result
   re-ranking are reserved capabilities (`GOALS.md`), not gaps to fill.
2. **Budget every output.**
   No code path returns unbounded provider text to the model. `format.ts` owns
   the budget; `providers.ts` never returns raw payloads upward.
3. **Zero-config must keep working.**
   A fresh install with no environment variables searches successfully. API
   keys and env knobs may only adjust depth.
4. **No new runtime dependencies, build steps, or disk state.**
   `typebox` and `@earendil-works/pi-tui` are host-provided. If a change needs
   anything else, it needs a design decision recorded in `DESIGN.md` first.
5. **Stay model-agnostic.**
   Plain schemas, plain text output, tolerant argument normalization. No
   enums, unions, or provider-specific constructs.
6. **Failover, never retry.**
   One ordered pass across providers; a failure is recorded with its provider
   name; a caller abort is not a provider failure.
7. **Keep `websearch.ts` free of Pi imports.**
   Logic that can be tested without the host must stay testable without it.

## Commands

```bash
npm test           # node --test, no network access
npm run typecheck  # tsc --noEmit
```

There is no build step and no lint script.

## Implementation Notes

- `src/index.ts` owns the tool name, description, schema, and TUI call line.
  It contains no search logic.
- `src/websearch.ts` owns config, argument normalization, provider order,
  timeouts, failover, and error text.
- `src/providers.ts` owns transport and response parsing into `SearchResult[]`.
- `src/format.ts` owns the character budget and the compact rendering.
- TypeScript is strict. Local imports use explicit `.ts` extensions, matching
  the host's Jiti resolution.
- The provider text layouts are parsed, not trusted. When a provider changes
  its output, add a fixture to `test/providers.test.ts` and keep a fallback in
  place rather than widening the parser speculatively.

## Testing

- Every behavior change lands with a test that fails without it.
- Tests never touch the network; inject a fake `Fetcher`.
- Budget changes are pinned by assertions on length or content, not by eyeballing
  a live response.
- Live smoke checks are manual, not part of `npm test`:
  `pi -p --no-session -nc -nbt -t websearch -e "$PWD/src/index.ts" "<prompt>"`
- In this repository, `node --test --experimental-strip-types test/*.test.ts`
  is norm; Node 26 runs it directly.

## Scope Boundaries

- Do not modify Pi itself as part of this extension; Pi bugs and API gaps need
  a separate proposal.
- Do not import from other extensions or assume their presence.
- Do not add a config UI, persistent settings file, or session cache without a
  GOALS/DESIGN decision.
- Keep `README.md`, `DESIGN.md`, and tests in step with behavior. A behavior
  change with stale docs is an unfinished change.

## Commits

Follow `GITFLOW.md`: single trunk, small verifiable commits, Chinese subject
with a conventional type prefix.
