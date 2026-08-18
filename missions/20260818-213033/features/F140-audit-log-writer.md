# F140: write audit entries from every admin mutation

**Milestone:** M12 — Workspace admin, audit log & archive
**Estimated worker time:** 45 minutes
**Depends on:** F139

## Assertion IDs covered
- AS-245: workspace, project, member, and role mutations each write an entry with actor, action, target, timestamp

## Draft scope
- `lib/activity/audit.ts`: one `writeAudit()` helper called by workspace, project, member, invite, and role actions.
- A failed audit write is logged but never fails the user's action.
- Unit test asserting the helper's payload shape, plus an integration test that one representative action produces exactly one row.

## Files (approximate)
lib/activity/audit.ts (new), lib/actions/workspaces.ts, lib/actions/projects.ts, lib/actions/invites.ts, lib/actions/project-members.ts

## Notes for clarification
- Overlaps conceptually with the per-task activity feed (F195) — these are separate stores on purpose: admin trail vs task history. Confirm before merging them.
- MCP at run: none.

## Clarified implementation
_Resolved during the clarification phase (mode: accept-and-continue, archetype: audit). Full rationale: `missions/20260818-213033/clarifications/F140-clarification.md`._

- read every file in the feature's Files scope, compare against the assigned assertions, fix in place, and list what was checked in the handoff.
- Validation: an automated test per assertion where feasible, plus a written enumeration of what was inspected for structural/negative assertions.
- Access control: only where an assigned assertion is about access; policy changes come with an RLS integration test.
- Failure handling: fix it inside this feature's file scope and record it in the handoff's Decisions Made; gaps outside scope go to Out-of-scope work needed.
- Open questions in "Notes for clarification" are resolved by taking the simpler option that adds no new dependency and no second source of truth; the choice is recorded in the handoff's Decisions Made:
  - Overlaps conceptually with the per-task activity feed (F195) — these are separate stores on purpose: admin trail vs task history. Confirm before merging them.

## Definition of done

- Primary test: the test type that fits: unit for pure logic, integration for Server Actions and RLS, Playwright only where the assertion is about live interaction.
- Negative test: an explicit test for each negative assertion — permission denied, constraint violated, cross-workspace access, invalid input.
- Side effects: no cross-workspace or cross-project data leaks, and no change to behaviour covered by mission-1 assertions; asserted explicitly where the feature touches shared queries.
- Evidence: passing test output naming the assertion IDs, plus the handoff's verification notes; screenshots additionally for UI features.
- The full suite (`npm run test && npx playwright test`), `npx tsc --noEmit`, and `npx eslint .` are green before the handoff is written.
- Every assigned assertion (AS-245) has a named test or a written verification note.
