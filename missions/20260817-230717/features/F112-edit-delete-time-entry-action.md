# F112: edit delete time entry action

**Milestone:** M9 — Time tracking
**Estimated worker time:** 25 minutes
**Depends on:** F110

## Assertion IDs covered
- AS-169, AS-170

## Draft scope
- lib/actions/time-entries.ts: editTimeEntry(entryId, updates: minutes?/billable?/note?/entryDate?) — only the entry's own author may edit (not admin/owner — this is a personal record of one's own time, unlike comments); updateTaskTags-style Zod partial update.
- deleteTimeEntry(entryId) — author OR workspace admin/owner may delete (admin/owner override needed for correcting mistakes in team reporting).

## Files (approximate)
lib/actions/time-entries.ts (extend)

## Clarified implementation
- Edit is author-only (stricter than delete) since editing someone else's logged hours without their involvement is a bigger trust violation than an admin cleaning up a clearly-wrong entry by deleting it.

## Definition of done
- Integration tests: author can edit own entry; a different member cannot edit another's entry (server-side rejected); author or admin/owner can delete; a different regular member cannot delete another's entry.
