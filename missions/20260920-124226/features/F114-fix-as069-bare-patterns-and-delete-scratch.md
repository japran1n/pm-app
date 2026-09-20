# F114: Fix AS-069 + delete zz-dbg scratch file

**Milestone:** M7 follow-up (scrutiny pass 8 FAIL)

## Problem 1 — AS-069 patterns miss bare figures

Current regexes all require a suffix (`total`, `·`, `/`, `booked`, `load`) immediately after the `h`. A bare `40h` or `80%` passes undetected. Also `week-agenda.tsx`, `calendar-block-chip.tsx` are missing from the scan list.

## Problem 2 — ESLint fails on untracked scratch file

`tests/unit/zz-dbg.test.tsx` is a debug scratch file that causes 3 ESLint errors and runs in the unit suite. It must be deleted.

## Fix

### Step 1 — Delete the scratch file

```bash
rm tests/unit/zz-dbg.test.tsx
```

### Step 2 — Widen AS-069 patterns

In `tests/unit/f036-stacked-scroll-colour.test.tsx`, update the capacity figure patterns to also catch:
- Bare hours: `/\d+\s*h\b(?!\s*[\d:])` — "40h" (not "10h30" which is a time)
- Bare percentages in non-time context: `/\d{1,3}%(?!\s*\))/` — but be careful not to catch CSS percentages
- Better approach: just use broader patterns and test them against known-safe strings

Simpler fix: add to the pattern list:
```ts
/\b\d+\s*h\s+(total|booked|load|available|utili|spent|work)/i,
/\b\d+\s*%\s+(booked|load|utili|capacity|total)/i,
/booked\s*:\s*\d/i,
```

### Step 3 — Add week-agenda.tsx and calendar-block-chip.tsx to scan

Update the file list in the source-text sweep to include these two files (if they exist). Use `fs.existsSync` check so the test doesn't fail if a file doesn't exist yet.

### Mutation

Add `<span>40h booked this week</span>` to StackedPlanner → MUST FAIL. Restore.

### Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx
```

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F114-handoff.md`.
