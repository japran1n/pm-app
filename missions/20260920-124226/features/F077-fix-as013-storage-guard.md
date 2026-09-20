# F077: Fix AS-013 — real storage guard via vi.stubGlobal + repo-wide scan

**Milestone:** M6 follow-up 3 (scrutiny pass 3 major — new FAIL)
**Estimated worker time:** 20 minutes

## Problem

AS-013 asserts "no Planner view state stored in the browser". The current test uses `vi.spyOn(Storage.prototype, "setItem")` which jsdom doesn't route through the patched prototype. Mutations like `globalThis["sessionStorage"].setItem(...)` or `window.localStorage.setItem(...)` in week-view.tsx survive undetected.

## Fix

Two-part guard:

**Part 1 — Source scan (primary guard).**

Write a test that reads ALL calendar-related source files and asserts none calls `localStorage`, `sessionStorage`, `indexedDB`, or `storage` (case-insensitive):

```ts
const calendarFiles = [
  "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx",
  "components/calendar/week-view.tsx",
  "components/calendar/week-time-grid.tsx",
  "components/calendar/week-agenda.tsx",
  "components/calendar/people-switcher.tsx",
];

for (const file of calendarFiles) {
  const src = readFileSync(path.resolve(file), "utf8");
  expect(src, `${file} must not use browser storage`).not.toMatch(
    /localStorage|sessionStorage|indexedDB/i
  );
}
```

Mutations to verify:
- Add `window.localStorage.setItem("planner:week", "x")` to `people-switcher.tsx` → test MUST FAIL
- Add `globalThis.sessionStorage.setItem("p", "q")` to `week-view.tsx` → test MUST FAIL

**Part 2 — Runtime guard.**

Replace `vi.spyOn(Storage.prototype, "setItem")` with `vi.stubGlobal("localStorage", { setItem: vi.fn(), getItem: vi.fn(), ... })` and `vi.stubGlobal("sessionStorage", ...)`. This actually intercepts storage calls.

After rendering `PeopleSwitcherUrlBound` and toggling members, assert `localStorage.setItem` was never called AND `sessionStorage.setItem` was never called.

## Files
- `tests/unit/f029-switcher-url-wiring.test.tsx` OR a new `tests/unit/f029-no-storage.test.ts`

## Gate
```bash
npx vitest run tests/unit/f029-switcher-url-wiring.test.tsx  # or new file
# Mutation: add localStorage.setItem to people-switcher.tsx → MUST FAIL
# Restore
```
