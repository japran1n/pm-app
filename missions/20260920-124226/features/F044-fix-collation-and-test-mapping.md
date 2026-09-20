# F044: deterministic collation + fix AS-015 test + fix AS-072 test labels

**Milestone:** M1 — Pure logic (follow-up from M1-scrutiny-1)
**Estimated worker time:** 20 minutes
**Depends on:** F006, F007

## Assertion IDs covered
- AS-058: whole-team ordering is deterministic (locale-invariant)
- AS-072: test IDs match the assertions they exercise

## Fixes

### 1. AS-058 — deterministic sort in orderPeopleForWholeTeam
Replace bare `localeCompare()` with:
```ts
a.name.localeCompare(b.name, "en", { sensitivity: "base" })
```
Extend the test fixture with non-ASCII name (`Ärla`) and document expected position.

### 2. AS-015 — remove the vacuous test
The current AS-015 test in planner-people-selection.test.ts passes an unused 
`view: "week"` key and asserts nothing useful. Delete it.
AS-015 belongs at the Planner route layer (F031) where ?view= can actually be
supplied via searchParams. Add a comment in F031's spec noting this.

### 3. AS-072 — fix stacked-window test ID labels
In tests/unit/planner-stacked-window.test.ts:
- Tests currently titled "AS-020/AS-021" exercise the fully-outside cases → rename to "AS-020"
- Tests currently titled "AS-022" exercise partial overlap clipping → rename to "AS-022"
- Saturday/Sunday tests carry no ID → add "AS-021" label
