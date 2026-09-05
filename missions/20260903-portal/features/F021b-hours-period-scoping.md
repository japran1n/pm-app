# F021b: The hours view adds up two different budgets

**Milestone:** M4 remediation — **blocker**
**Estimated worker time:** 2 h
**Opened by:** the M4 gate, orchestrator-verified

## The defect

`hours/page.tsx` asks the RPC for `2000-01-01 → today` (verified:
`const WIDE_FROM = "2000-01-01"`). `project_hours_client` then
aggregates weekly and by-category totals across that entire range, while
picking `sold_minutes` from a single budget chosen by overlap
(`order by period_start desc limit 1`).

A project with a closed 2025 budget where 40h were used and a current
2026 budget with 5h of 40h used reports **Used 45h, Remaining 0h, "+5h
Over"**. Every tile is wrong, the whole burn-down is wrong, and it is
wrong in the direction that starts a false conversation about an
overrun — the single most damaging thing this view can get wrong, since
the client's next move is to question the invoice.

The chart's caption discloses the date range, which does not repair the
arithmetic. Disclosure is not correctness.

## Scope

1. The view asks for **one budget period** — the current one, or the
   most recent if none is current — and the RPC's aggregates cover that
   period only. Used, remaining, planned and the weekly series must all
   describe the same window as `sold_minutes`.
2. Where a project has several past periods, give the client a way to
   see them, or say plainly that this view shows the current period.
   Either is honest; silently summing them is not.
3. A project with no budget at all keeps F019's honest empty treatment.
4. A test with two budget periods and entries in both, asserting the
   tiles describe only one. That fixture is the whole point — the defect
   is invisible to any test with a single budget, which is why it
   shipped.

## Definition of done

- **Primary success test:** the two-period fixture reports the current
  period's used, remaining and series, not the sum.
- **Failure test:** a single-period project is unchanged.
- **Manual verification:** the caption describes the window the numbers
  actually cover.
- **Side-effect verification:** F017's RPC tests and F019's chart tests
  pass.
