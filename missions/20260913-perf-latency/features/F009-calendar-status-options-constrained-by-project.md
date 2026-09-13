# F009: Calendar status options constrained by project

**Milestone:** M2 — Query narrowing

**Est:** 30 min · **Depends on:** none
**Covers:** AS-008, AS-011
- `getWorkspaceStatusOptions` scans all 30,998 `project_statuses` rows through `is_project_visible_to` to return 22 — measured 995 ms
- Resolve the workspace's visible project ids first, then `.in("project_id", ids)`; the index `project_statuses_project_id_position_idx` exists
- `my-tasks/page.tsx` already does exactly this on the same table — follow it
- Verify the returned set and order are unchanged
**Files:** `lib/queries/calendar.ts`

## Clarification status

`[CLARIFIED-AUTO]` — this mission's `description.md` and the measured audit it
cites resolve the scope of every feature. The audit named the file, the line
and the mechanism for each change, so there is no open question about *what*
to change; the worker's judgement is about *how*, within the constraint below.

## The constraint that overrides everything else in this spec

This is a refactor. AS-025 says no page touched by this mission changes what
it displays, what it accepts, or how it responds to input. If making this
feature faster requires changing what a user sees, **stop and write a BLOCKED
handoff** — do not make the change, and do not "improve" the behaviour while
you happen to be in the file. A faster page that behaves differently is a
failed feature here, not a bonus.

## Notes for the worker

- Read `missions/20260913-perf-latency/tech-decisions.md` first, especially "Request-scoped
  memoisation" and "Database changes are additive only".
- Do **not** start a dev server. Port 3000 belongs to the user, who is using
  the app while you work. Verify by unit test and by reading the code.
- Supabase MCP is available for reading schema and for applying the one
  additive migration in F012. Never drop or alter an existing database object.
- Every assertion under **Covers** must be verifiably true when you finish,
  and each needs its own line in the handoff under `## Assertions covered`.
- Commit as `feat(F009): <summary> [assertions: AS-008, AS-011]`
  before exiting. The pre-worker-exit hook blocks you otherwise.
