# F052 clarification

## Clarified implementation

Add exactly 4 new test cases to `tests/unit/planner-people-selection.test.ts`.
All use `selfId: "member-c"` with `activeMemberIds: ["member-a", "member-b", "member-c"]`
so selfId is NOT at index 0.

No implementation changes — test-only fix.

## Definition of done
- Mutating the `"me"` branch to `return [activeMemberIds[0]]` fails at least one test
- Mutating the empty/null/all-invalid fallback to `return [activeMemberIds[0]]` fails at least one test
- All tests pass
- `npx tsc --noEmit` clean
- Commit made
