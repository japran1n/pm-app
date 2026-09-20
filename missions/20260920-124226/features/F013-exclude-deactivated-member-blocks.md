# F013: Blocks from deactivated members excluded even when their id is passed

**Milestone:** M3 — Data layer
**Depends on:** F012

## Assertion IDs covered
- AS-031: A deactivated member's blocks are not rendered even when their id is present in `?people=`.

## What to build

In `lib/queries/calendar-blocks.ts` (the multi-user query from F012), ensure that a deactivated member's blocks are NOT returned even if their userId is explicitly passed in the `userIds` array.

Approach taken: before querying blocks, resolve `userIds` against the
active `workspace_members` table -- strip any userId that doesn't have
`status = 'active'` in that workspace -- then query only with the active
subset.

## Clarified implementation

- `getCalendarBlocks` narrows the supplied `userIds` to those with
  `workspace_members.status = 'active'` in `workspaceId` before applying
  the `.in("user_id", ...)` restriction on `calendar_blocks`.
- If none of the supplied ids are active members, the function
  short-circuits to `[]` without querying `calendar_blocks`.
- `workspace_members` currently only has `status in ('invited', 'active')`
  (no literal `'deactivated'` value) -- "deactivated" is treated as "not
  currently active", so an `invited` or otherwise non-active id is also
  excluded, which is the safe superset of the assertion's requirement.

## Definition of done

- Unit test: `userIds` containing a deactivated (non-active) member's id
  returns none of their blocks.
- Unit test: `userIds` containing an active member's id still returns
  their blocks.
- Unit test: a mixed selection only returns the active member's blocks.

### Gate

```bash
npx tsc --noEmit
npx vitest run tests/unit
```
