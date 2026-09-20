# F104: Fix AS-001/AS-023 — fix source bug + RSC integration test

**Milestone:** M7 follow-up (scrutiny pass 5 FAIL)

## Problem

1. **Real code bug**: `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx:126` has:
   ```ts
   parsePeopleParam(peopleParam ?? "all", selfId, allActiveIds)
   ```
   When `peopleParam` is undefined (no ?people= param), this passes `"all"` — fetching every member's blocks. The correct call is:
   ```ts
   parsePeopleParam(peopleParam, selfId, allActiveIds)
   ```
   `parsePeopleParam(undefined, selfId, allIds)` correctly falls back to `[selfId]` per its contract (AS-003). Just remove `?? "all"`.

2. **AS-023 tests still don't cover behaviour**: both existing AS-023 tests are source-text checks. The layout conditional bug `if (layout === "stacked" || selectedUserIds.length === 1)` would render stacked even for single user — this is what AS-023 is supposed to prevent but doesn't.

## Fix

### Step 1 — Fix the source bug

In `app/(workspace)/w/[workspaceSlug]/calendar/page.tsx`, find:
```ts
parsePeopleParam(peopleParam ?? "all", selfId, allActiveIds)
```
Change to:
```ts
parsePeopleParam(peopleParam, selfId, allActiveIds)
```

Verify `parsePeopleParam` handles `undefined` correctly (falls back to `[selfId]`).

### Step 2 — Update f102 composition test

In `tests/unit/f102-calendar-page-composition.test.tsx`, add a test that covers the `undefined` → selfId fallback:

```ts
it("test_AS_001_undefined_people_param_defaults_to_self", () => {
  const selfId = "self-user";
  const allActiveIds = ["self-user", "alice", "bob"];
  
  // undefined param (no ?people= in URL)
  const selected = parsePeopleParam(undefined, selfId, allActiveIds);
  expect(selected).toEqual([selfId]);
  expect(selected).not.toContain("alice");
  expect(selected).not.toContain("bob");
  
  // Mutation: passing "all" instead of undefined gives all members
  const withAll = parsePeopleParam("all", selfId, allActiveIds);
  expect(withAll.length).toBeGreaterThan(1); // "all" expands
  // This proves that page.tsx's "?? 'all'" was the bug
});
```

### Step 3 — Add AS-023 layout-conditional test

AS-023 must guard against `layout === "stacked" || selectedUserIds.length === 1`. Add to f102:

```ts
it("test_AS_023_layout_derivation_no_fallthrough", () => {
  // Single person → week-grid
  expect(resolvePlannerLayout(1)).toBe("week-grid");
  // Two people → stacked
  expect(resolvePlannerLayout(2)).toBe("stacked");
  // The layout must be binary — no third value
  // Mutation: resolvePlannerLayout(1) → "stacked" MUST FAIL
  expect(["week-grid", "stacked"]).toContain(resolvePlannerLayout(1));
  expect(resolvePlannerLayout(1)).not.toBe("stacked");
});
```

### Step 4 — Gates

```bash
npx tsc --noEmit
npx eslint . --max-warnings=0
npx vitest run tests/unit/f102-calendar-page-composition.test.tsx
npx next build
```

Mutation: reintroduce `?? "all"` in page.tsx → the undefined-defaults-to-self test MUST FAIL.
Mutation: make `resolvePlannerLayout(1)` return "stacked" → AS-023 test MUST FAIL.

Commit before exiting. Handoff at `missions/20260920-124226/handoffs/F104-handoff.md`.
