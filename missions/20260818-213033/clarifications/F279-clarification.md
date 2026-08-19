# F279 Clarification

_Generated: 2026-08-19T09:50:00Z_  _Mode: inherited from parent F154 (follow-up created by /mission-run from a measured regression)_

See `missions/20260818-213033/clarifications/F154-clarification.md` for the full record.

## Deltas from the parent

- Acceptance is numeric: the perf-budget test must pass with PERF_BUDGET_MS unchanged.
- Raising the budget is explicitly out of bounds; a genuine inability to meet it is reported as PARTIAL with measurements.
