# pi-lite-websearch Design Philosophy

> Established 2026-09-10. The criteria every change is judged against. This
> document names no format, field, flag, library, or file, because those change
> and these clauses do not.

Two rules govern its use. When a proposal cannot be judged by what is written
here, the clauses have a gap, and the fix is a new clause. When a verdict feels
wrong, the fix is to amend the clause, never to route around it.

## The Root Proposition

> A search tool is a context transformer, not a data pipe.

The provider moves bytes; this tool decides what the model pays to read. A
search that transfers 20 KB and yields five unusable paragraphs has failed at
the only job that matters. Output is judged per token, not per response.

Three consequences follow:

1. Every returned character is a deliberate purchase, not a passthrough.
2. Coverage is the provider's problem; relevance density is ours.
3. The default answer to "should we return more?" is no, and the answer to
   "should we return it more cheaply?" is always open.

## Clause 1. The Model Pays for Every Character

The context window is the scarcest resource in the session. A tool that ignores
its output size spends the user's money on its own formatting.

In practice:

- Output has an explicit budget with a documented default and a hard ceiling.
- Nothing unbounded reaches the model, including error messages.
- Compaction removes structure the provider sends for humans (separators,
  provenance headers, empty fields), not information the model can use.
- A truncated result says so; silent truncation is a lie the model cannot see.

## Clause 2. Zero Config Must Answer the Question

The first search after install succeeds without a key, a config file, or a
setup step. Configuration exists to make a working tool better, never to make
it work.

In practice:

- No credential is required for the default path.
- Every environment variable has a working default; deleting all of them
  changes nothing essential.
- Configuration failure degrades a feature (better rate limits, a second
  provider), never availability.

## Clause 3. Speed Is a Feature, and Its Worst Case Is Bounded

A slow search is worse than a narrow one: it stalls the whole turn. Latency is
designed, not observed after the fact.

In practice:

- One request per search on the happy path; no retry loops.
- Timeouts are short and enforced at the transport boundary.
- Failover is one bounded extra attempt, not an open-ended attempt sequence.
- Optional richness that adds a round trip does not ship.

## Clause 4. No Model Left Behind

The tool must behave identically on a frontier model and a small one. Model
quality is not an input to the design.

In practice:

- Parameters use the plainest schema the host supports: no enums, no unions,
  no provider-specific constructs.
- The tool result is plain text any model can read; no content type is
  required to consume it.
- Argument normalization absorbs the sloppiness weaker models produce instead
  of spending a validation round trip to teach them.
- Instructions live in the tool description the model always receives, not in
  a system-prompt agreement only strong models follow.

## Clause 5. Failover Beats Retry

A retry asks the same question again and usually gets the same answer. A second
provider is a different implementation with different failure modes.

In practice:

- Providers are ordered, and the next one runs only after the previous one
  fails or returns nothing.
- A failure is recorded with the provider name so the model and the user can
  tell what actually broke.
- Caller cancellation is not a provider failure and never triggers failover.

## Clause 6. Smallness Is a Constraint That Produces Reliability

Every dependency, build step, background process, and source file is a place
the tool can break when nothing about search has changed.

In practice:

- Runtime dependencies are limited to what the host already provides.
- Source is loaded as-is; no build artifact can drift from its source.
- No state is written to disk; there is nothing to migrate or corrupt.
- Module count follows the smallest set of responsibilities that can be tested
  independently.

## Clause 7. Tighten Scope, Reserve Capability

"Out of scope for now" and "architecturally impossible" are different
statements, and confusing them costs in both directions.

In practice:

- The tool does one thing: search. Fetching, crawling, and multi-query fan-out
  are reserved, and the transport layer is written so they can reuse it.
- Provider specifics stay behind the adapter boundary; adding a provider must
  not touch formatting, budgets, or tool registration.
- Scope decisions tighten at any time; the transport and parser seams barely
  move.

## Decision Checklist

Walk every proposal through these in order. On any hit, the proposal changes
shape or does not ship.

| # | Question | A hit violates |
|---|----------|----------------|
| 1 | Does output grow without an explicit budget? | Clause 1 |
| 2 | Does it make a working search require setup? | Clause 2 |
| 3 | Does it add an unbounded wait or an extra round trip? | Clause 3 |
| 4 | Does it assume a specific model, provider, or schema feature? | Clause 4 |
| 5 | Does it retry the same provider instead of failing over? | Clause 5 |
| 6 | Does it add a runtime dependency, build step, or disk state? | Clause 6 |
| 7 | Does it close off a reserved capability without a real proposal? | Clause 7 |

Every proposal that has been judged records the verdict where the proposal
lives, with the clause numbers it was measured against (see DESIGN.md).

## Amending This Document

A clause changes only when a real proposal has shown it to be wrong, and the
change records which proposal did so. Clause numbers are permanent. A retired
clause keeps its number and gains a note, so references from decisions and
commits stay valid.
