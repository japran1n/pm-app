# F052: fix AS-003/AS-008 test fixtures — selfId must differ from activeMemberIds[0]

**Milestone:** M1 follow-up (M1-scrutiny-4 blocker)
**Estimated worker time:** 15 minutes
**Depends on:** F002, F003

## Assertion IDs covered
- AS-003: `"me"` resolves to the signed-in member (selfId)
- AS-008: all-invalid/empty-param falls back to selfId (not first roster member)

## Problem

In `tests/unit/planner-people-selection.test.ts`, the test constants are:
```ts
const SELF_ID = "member-self";
const ACTIVE_MEMBER_IDS = ["member-self", "member-a", "member-b", "member-c"];
```

`selfId` is `activeMemberIds[0]`. This means:
- Mutating the `"me"` path to `return [activeMemberIds[0] ?? selfId]` keeps all tests green
- Mutating the empty/no-param fallback the same way keeps all tests green
- Mutating the all-invalid fallback the same way keeps all tests green

The implementation is correct, but the tests can't detect a bug that returns the
first roster member instead of the actual signed-in member.

## Fix

Add test cases where `selfId` is NOT `activeMemberIds[0]`. Example:

```ts
// Add to the "me" path tests:
it("resolves 'me' to selfId even when selfId is not first in roster", () => {
  const result = parsePeopleParam("me", {
    selfId: "member-c",
    activeMemberIds: ["member-a", "member-b", "member-c"],
  });
  expect(result).toEqual(["member-c"]);
  // NOT ["member-a"] — this would fail if returning activeMemberIds[0]
});

// Add to the fallback/empty tests:
it("falls back to selfId (not roster[0]) when param is empty", () => {
  const result = parsePeopleParam("", {
    selfId: "member-c",
    activeMemberIds: ["member-a", "member-b", "member-c"],
  });
  expect(result).toEqual(["member-c"]);
  // NOT ["member-a"]
});

it("falls back to selfId (not roster[0]) when all ids are invalid", () => {
  const result = parsePeopleParam("unknown-id", {
    selfId: "member-c",
    activeMemberIds: ["member-a", "member-b", "member-c"],
  });
  expect(result).toEqual(["member-c"]);
  // NOT ["member-a"]
});

it("returns null/undefined param as [selfId] when selfId is not first in roster", () => {
  const result = parsePeopleParam(null, {
    selfId: "member-c",
    activeMemberIds: ["member-a", "member-b", "member-c"],
  });
  expect(result).toEqual(["member-c"]);
});
```

No changes to the implementation — just tests.

## Files
- `tests/unit/planner-people-selection.test.ts` only

## Gate

Mutation test (do NOT commit this — just verify locally):
- Temporarily change `parsePeopleParam` to return `[activeMemberIds[0] ?? selfId]`
  for the `"me"` branch and for the empty/fallback branch
- At least one of the new tests must fail

```bash
npx vitest run tests/unit/planner-people-selection.test.ts
npx tsc --noEmit
npx eslint tests/unit/planner-people-selection.test.ts --max-warnings=0
```
All must pass/clean.
