# F113: Fix AS-064/AS-065 — DOM order assertion + correct week key format

**Milestone:** M7 follow-up (scrutiny pass 8 FAIL)

## Problem

1. **AS-064**: F103 added real keyboard drag, but only checks relative pair order in the URL. `reverse()` the splice → wrong URL order but no DOM order check → survives.

2. **AS-065**: Week fixtures use `"2026-W38"` / `"2026-W39"` format which `parseWeekKey` rejects (real keys are Monday-anchored `YYYY-MM-DD` like `"2026-09-14"`). The test asserts preservation of a format that would not survive a reload.

## Fix

### Step 1 — Read the real week key format

Read `lib/calendar/week-nav.ts`. Find the format `currentWeekKey` or `parseWeekKey` returns — it should be `YYYY-MM-DD` (Monday date). Use that format in test fixtures.

### Step 2 — Fix AS-065 week format in f035

In `tests/unit/f035-stacked-reorder.test.tsx`, change:
```ts
weekParam="2026-W38"  // WRONG — parseWeekKey rejects this
```
to:
```ts
weekParam="2026-09-14"  // CORRECT — Monday of week 38
```

And in the assertion, check `week=2026-09-14` in the URL.

### Step 3 — Add DOM order assertion for AS-064

After the drag gesture, assert the **rendered DOM order** has changed (not just the URL). The rows must appear in the new order in the DOM:

```ts
// After drag: alice should come before carol in the DOM
const rows = screen.getAllByTestId(/stacked-person-row-/);
const aliceIdx = rows.findIndex(r => r.dataset.testid === "stacked-person-row-alice");
const carolIdx = rows.findIndex(r => r.dataset.testid === "stacked-person-row-carol");
expect(aliceIdx).toBeLessThan(carolIdx); // alice before carol after drag
```

Mutation: `splice + reverse()` instead of correct reorder → DOM order is wrong → MUST FAIL.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f035-stacked-reorder.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F113-handoff.md`.
