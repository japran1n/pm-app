# F020: Durable todo optimistic guard (FU-J)

**Milestone:** M1
**Estimated worker time:** 30 min
**Depends on:** F019

## Assertion IDs covered
- AS-012, AS-014

## Scope

`components/my-tasks/personal-todo-list.tsx`: F019's guard closes at the same tick as `setTodos` (`:148`/`:151`), so a `router.refresh()` post-commit but pre-render still overwrites the confirmed value silently.

Fix: the guard must persist UNTIL the next server-data sync that includes the confirmed value. Options:
- Track `{id, confirmedIsDone}` in the pending set and only remove when incoming server data matches the confirmed value
- OR use a version/sequence counter that the sync effect respects

Also fix the tests in `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx` — the two `_survives_a_server_data_refresh_` tests are vacuous (deleting the guard leaves 7/8 passing). Rewrite them so that deleting `personal-todo-list.tsx:38-59` (the entire guard block) causes them to fail.

## Files
`components/my-tasks/personal-todo-list.tsx`, `tests/unit/f006-my-tasks-checkbox-optimistic.test.tsx`

## Definition of done
- AS-012: PASS — deleting the guard block fails the test
- AS-014: PASS — same
