# Handoff: F013 — Exclude deactivated members' blocks even when their id is passed

## Status
COMPLETE

## Assertions covered
AS-031: PASS — `getCalendarBlocks` narrows `userIds` to `workspace_members.status = 'active'` before restricting `calendar_blocks`; verified by tests/unit/calendar-blocks-active-members.test.ts (deactivated-id → empty, active-id → returned, mixed → only active).

## Files changed
- lib/queries/calendar-blocks.ts (active-member narrowing added ahead of the `.in("user_id", ...)` restriction; this landed in the same commit as F012's `userIds` param — see Notes)
- tests/unit/calendar-blocks-active-members.test.ts (new — AS-031 coverage)
- missions/20260920-124226/features/F013-exclude-deactivated-member-blocks.md (new — spec was missing on disk, written from the task brief)

## Commands run
`npx tsc --noEmit` (0)
`npx vitest run tests/unit/calendar-blocks-active-members.test.ts tests/unit/calendar-block-datetime.test.ts tests/unit/calendar-block-colors-fallback.test.ts` (0, 10 passed)
`npx vitest run tests/unit` (0 for calendar-blocks tests specifically; the full suite has 133 pre-existing unrelated failures across ~41 files — architecture-board, portal, list-view, component-panel tests, none touching calendar-blocks.ts or workspace_members — confirmed by grepping the failure list, none match `calendar-block`)

## Decisions made
- Implemented the "resolve userIds against active workspace_members first" approach the spec calls "preferred": one extra `select("user_id")` query against `workspace_members` scoped by `workspace_id` + `status = 'active'` + `.in("user_id", userIds)`, then the narrowed id list feeds the existing `.in("user_id", ...)` on `calendar_blocks`. Kept it inside `getCalendarBlocks` itself (per spec: "every caller inherits it") rather than a separate `lib/calendar/people-selection.ts` helper, since the entire narrowing is a single extra query tightly coupled to this function's own `userIds` param — no other caller needed the general form.
- `workspace_members.status` only has `'invited' | 'active'` today (no `'deactivated'` literal exists in the schema per `supabase/migrations/20260817222532_create_workspaces.sql`). Treated "deactivated" as "not `status = 'active'`" rather than waiting on a schema change — this is a safe superset (also correctly excludes merely-invited, not-yet-active members) and matches AS-031's wording ("a deactivated member's blocks are not rendered").
- If the narrowed active-id set is empty, short-circuit to `[]` without hitting `calendar_blocks` at all (mirrors the existing empty-`userIds`-array short-circuit from F012).

## Out-of-scope work needed
- F014 (people switcher) needs the same "not offerable if deactivated" rule at the UI-selection layer — the feature spec notes this pairs with F014; not touched here since it's a different file/layer.
- If `workspace_members.status` ever gains a literal `'deactivated'` value distinct from `'invited'`, no code change is needed here (this filter already excludes anything that isn't `'active'`), but worth a follow-up test once that value exists.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Wrote missions/20260920-124226/features/F013-exclude-deactivated-member-blocks.md since it didn't exist on disk under that filename (a differently-named F013-exclude-deactivated-blocks.md existed with a shorter draft-scope version); used the task-brief spec text verbatim as the source of truth per instructions, and cross-referenced the existing draft file's assertion/milestone metadata.
AUTONOMOUS_DECISION: Found lib/queries/calendar-blocks.ts had been concurrently modified by another worker process mid-session — first read showed no `userIds` param, a subsequent Edit attempt failed to match, and a later Read showed `userIds` support already present (from F012's commit). Applied my active-member-narrowing change on top of that F012 state rather than re-deriving F012's own `userIds`/`.in()` plumbing, since a git commit (`7ade4f5d feat(F012): getCalendarBlocks multi-user query`) shows F012 landed with the combined content. Verified via `git log -p` that the committed F012 diff already contains this feature's active-member-narrowing block, so no separate app-code commit was needed from this worker — only the dedicated AS-031 test file.

## Notes for the next worker
- Concurrent-worker note: during this session, `lib/queries/calendar-blocks.ts` was observed to change on disk mid-task (F012 landed while F013 work was in progress), and the final committed F012 diff (`7ade4f5d`) already contains the F013 active-member-narrowing logic verbatim, including this handoff's own doc comments. That's an artifact of the two features being worked in close succession against the same file, not a bug — just flagging it so `/mission-status` / scrutiny doesn't get confused about which commit "owns" AS-031's implementation. The AS-031 test file is this worker's own, separate commit (`7537941e`).
- `workspace_members` schema: `supabase/migrations/20260817222532_create_workspaces.sql` — `status text not null default 'invited' check (status in ('invited', 'active'))`, `user_id` nullable (pending invites).
