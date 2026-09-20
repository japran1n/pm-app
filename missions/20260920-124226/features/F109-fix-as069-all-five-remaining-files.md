# F109: Fix AS-069 — render-level check for remaining 5 planner files

**Milestone:** M7 follow-up (scrutiny pass 7 FAIL)

## Problem

F106 rendered PlannerHeader and StackedPersonRow (2 of 7 files). Five files remain: `stacked-planner`, `week-view`, `week-time-grid`, `page.tsx`, and `components/calendar/week-view.tsx`. Also the current regex misses `"12 hours"` and `"8 / 40 hrs"` (no `total`/`·`/`/` right after `h`).

## Fix

### Step 1 — Extend the render test in f036-stacked-scroll-colour.test.tsx

Add render-level assertions for StackedPlanner component (rendered with blocks but no capacity data passed in). Check `document.body.textContent` for:
- `/\d+\s*h(ours?)?\s*(total|·|\/|booked|load)/i`
- `/utili[sz]ation/i`
- `/capacity/i`
- `/\d+\s*\/\s*\d+\s*h/i` (e.g. "8 / 40 hrs")
- `/\d+%/i` (percentage of any kind in capacity context — but be careful: block times like "10:00" are OK)

Actually for percentages, narrow it to: `/\d+%\s*(load|booked|capacity|utili)/i` to avoid false positives on time percentages.

### Step 2 — Fix the regex pattern gaps

Update the source-text sweep (if still in place) to also catch:
- `"12 hours"` → `/\d+\s+hours?\b/i`
- `"8 / 40 hrs"` → `/\d+\s*\/\s*\d+\s*hrs?\b/i`

### Mutation

Add `<span>{40}h total loaded / {8}h booked</span>` in StackedPlanner → test MUST FAIL. Restore.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F109-handoff.md`.
