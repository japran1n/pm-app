# Handoff: F316 — sanitise mention visibility for project-from-template tasks

## Status
COMPLETE

## Assertions covered
AS-376: PASS — `tests/integration/f316-project-from-template-mentions.test.ts` (2 new tests, real Supabase project): a mention referencing a workspace-outsider is stripped to "@Former member" in every task seeded by `createProjectFromTemplate`; a mention referencing a visible user survives (positive control). Also confirmed the sibling `createTaskFromTemplate` path (F313's own test) and the rest of the templates/mentions suite still pass unmodified.

## Files changed
lib/actions/templates.ts
tests/integration/f316-project-from-template-mentions.test.ts
missions/20260818-213033/handoffs/F316-handoff.md

## Commands run
`npx tsc --noEmit` (0)
`npx eslint lib/actions/templates.ts tests/integration/f316-project-from-template-mentions.test.ts` (0)
`npx vitest run tests/integration/f316-project-from-template-mentions.test.ts tests/integration/f313-mention-visibility-followup.test.ts tests/integration/project-from-template.test.ts tests/integration/template-actions.test.ts` (0, 26/26 passed)
`npx vitest run tests/integration/mention-visibility.test.ts tests/integration/task-templates-rls.test.ts` (0, 16/16 passed)
`npx vitest run` (full suite; 0/exit code but 16 pre-existing failures unrelated to this feature — see Notes)

## Decisions made
- Followed F313's recommended approach (b) exactly: post-RPC pass, not an inline SQL check inside the migration. `sanitiseMentionsForVisibility` (`lib/comments/mentions.ts`) needs `{projectId, workspaceId, projectVisibility}`, and the target project doesn't exist until `create_project_from_template` (supabase/migrations/20260822190000_rpc_create_project_from_template.sql) creates it, so the check cannot run beforehand. After the RPC returns, `createProjectFromTemplate` re-fetches every inserted task's `description_json` (`select id, description_json from tasks where project_id = <new project> and description_json is not null`) and re-runs the exact same helper `createTaskFromTemplate` already uses — no reimplementation of the visibility rule.
- Only tasks whose sanitised document differs from the stored one (`JSON.stringify` comparison) get an `UPDATE`; tasks with no mentions or only-visible mentions are left untouched, matching the spec's "don't touch every task unconditionally" instruction.
- `projectVisibility` is hardcoded to `"workspace"` for this pass rather than re-queried from the `projects` table, because the RPC's signature (`create_project_from_template(p_workspace_id, p_name, p_description, p_created_by, p_tasks)`) never accepts or sets a visibility, so the new project always carries the `projects` table's column default (`'workspace'`, set in supabase/migrations/20260821140522_projects_visibility_column.sql) at the moment this code runs, immediately after project creation in the same request. Documented this assumption in a code comment so a future worker who adds a visibility param to the RPC knows to update this too.
- Partial-failure handling: modeled on `bulkUpdateTasks` (lib/actions/tasks.ts) rather than F301's "fail the whole write" convention used by `addComment`/`editComment`/`editTask`/`createTaskFromTemplate`. Reasoning: those single-document writes haven't persisted anything yet when `sanitiseMentionsForVisibility` runs, so failing the whole call prevents any unsanitised write. Here the RPC has ALREADY committed the project and all its tasks atomically in its own transaction before this pass starts — there is nothing left to "fail the whole call" to roll back, and the project was created successfully by every other measure (workspace, key, name all valid). Aborting the entire post-RPC loop on one task's `MentionVisibilityCheckError` would leave every OTHER task's already-fetched-but-unsanitised description unpatched too, which is strictly worse than continuing. So each task is sanitised independently inside its own try/catch; a failure is logged server-side and that one task is skipped, the rest of the batch still gets checked, and `createProjectFromTemplate`'s own `ok: true` result (which reflects "the project was created", the RPC's own success) is unaffected by a downstream sanitisation-pass failure on an individual task.
- AS-376 is defense-in-depth here (same framing as F313): a hand-crafted payload bypassing the picker is still the primary threat this class of fix closes; the SQL RPC path is the second and (per this feature's own scope) final of the "copies description_json without checking" write paths in this codebase's template system.

## Out-of-scope work needed
- None identified beyond what F313's handoff already flagged. This closes the one sibling gap F313 called out (the SQL RPC copy path); no other template/description_json copy path remains unaudited in `lib/actions/templates.ts`.
- If/when F218 (custom project statuses/columns) extends `create_project_from_template` to accept a `visibility` (or other) parameter, the hardcoded `projectVisibility: "workspace"` in this pass (lib/actions/templates.ts, `createProjectFromTemplate`) needs to change to actually read the created project's `visibility` column instead of assuming the table default — flagged in a code comment at the call site.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose "log and skip per-task" over "fail the whole action" for a mid-batch `MentionVisibilityCheckError`, deviating from F301's single-document "fail loudly" convention, because the RPC's atomic commit already happened before this pass runs (see Decisions made) — matched `bulkUpdateTasks`' partial-failure-within-a-batch convention instead, per this feature's own instructions to look at that convention rather than inventing a new one.

AUTONOMOUS_DECISION: Used the `projects` table's known column default (`'workspace'`) directly rather than an extra `select visibility from projects` round-trip, since the RPC has no parameter to ever set it to anything else today — documented as an explicit assumption in code so it's easy to catch if that changes.

## Notes for the next worker
- The full `npx vitest run` (entire repo) has 16 pre-existing failures unrelated to this feature: Postgres statement timeouts on `generate_due_recurring_occurrences` (F178), Supabase Auth "Request rate limit reached" on rapid `auth.admin.createUser`/`signInWithPassword` calls across several suites, and `inviteMember` (F126) failures that also look like a knock-on effect of the same auth rate-limiting. None touch `lib/actions/templates.ts`, `lib/comments/mentions.ts`, or any templates/mentions test file. The targeted suite runs (templates + mentions, listed under Commands run) are clean. This is worth a look for the mission's test-infra health but is out of this feature's scope.
- No MCP tools were needed for this feature — this is pure application-code logic on top of an already-existing migration (F184's RPC) and an already-existing helper (F301/F313's `sanitiseMentionsForVisibility`). No schema change.
