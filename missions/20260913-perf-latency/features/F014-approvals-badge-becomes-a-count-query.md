# F014: Approvals badge becomes a count query

**Milestone:** M3 — Badge counters

**Est:** 30 min · **Depends on:** none
**Covers:** AS-013, AS-015
- `getOpenApprovalsForWorkspace` fetches rows, requester names, task titles and phases, then the layout calls `.length`
- Add `getOpenApprovalCountForWorkspace(workspaceId)`: one head count on `approval_requests` joined to the workspace's projects
- Keep the rich function for `/approvals` itself
**Files:** `lib/queries/approvals.ts`, `app/(workspace)/w/[workspaceSlug]/layout.tsx`

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
- Commit as `feat(F014): <summary> [assertions: AS-013, AS-015]`
  before exiting. The pre-worker-exit hook blocks you otherwise.
