# F042: fix clipBlockToStackedWindow — per-day segmentation + timezone contract

**Milestone:** M1 — Pure logic (follow-up from M1-scrutiny-1)
**Estimated worker time:** 45 minutes
**Depends on:** F005

## Assertion IDs covered
- AS-021: a block starting before 08:00 is clipped to 08:00
- AS-022: a block ending after 16:00 is clipped to 16:00 (now as a segment per day)

## Root cause
`clipBlockToStackedWindow` derives the weekday from the start instant only.
A `Sun 22:00Z → Mon 10:00Z` block is dropped (Sunday). A `Mon 09:00Z → Fri 15:00Z`
block returns only `Mon 09:00–16:00`; Tue–Fri vanish.
The return type `{starts_at, ends_at} | null` cannot express a multi-day result.

## Fix spec

Change the signature to:
```ts
export function clipBlockToStackedWindow(
  block: { starts_at: string; ends_at: string }
): Array<{ starts_at: string; ends_at: string }>
```
Returns an ordered array of per-day segments (one per Mon–Fri day the block overlaps).
Empty array if no overlap.

Algorithm:
- Parse starts_at and ends_at as UTC (require Z-suffix; treat missing Z as UTC).
- Enumerate each calendar date (UTC) from floor(starts_at) to ceil(ends_at).
- For each date whose UTC weekday is 1–5 (Mon–Fri):
  - windowStart = that date at 08:00Z, windowEnd = that date at 16:00Z
  - segStart = max(blockStart, windowStart), segEnd = min(blockEnd, windowEnd)
  - if segStart < segEnd → emit { starts_at: segStart.toISOString(), ends_at: segEnd.toISOString() }
- Return the collected segments in chronological order.

Timezone contract: the helper operates entirely in UTC. Callers that care about
wall-clock hours must convert before calling. Document this at the top of the file.

## Tests to add (in planner-stacked-window.test.ts)
- Sun 22:00Z → Mon 10:00Z → [Mon 08:00Z–10:00Z]
- Mon 09:00Z → Fri 15:00Z → 5 segments (Mon–Fri, each 08:00–16:00 except Mon and Fri)
- Fri 15:00Z → Sat 09:00Z → [Fri 15:00–16:00]
- Mon 08:00Z → Mon 16:00Z → [Mon 08:00–16:00] (exact boundary)
- Sat only → []
- Sun only → []
- Single day partial overlap → 1 segment (verifies old test still passes)

Fix existing mis-labelled test titles (AS-020/AS-021/AS-022 were scrambled).
