# Handoff: F015 — Team UI + portal: scope, decisions, assumptions

## Status
COMPLETE

## Assertions covered
AS-043: PASS — a project can record scope items marked included/excluded, each with its source. Team-side CRUD (`lib/actions/project-records.ts`'s `createScopeItem`/`updateScopeItem`/`deleteScopeItem`, `components/project/record-panel.tsx`'s Scope tab) and the portal read (`components/portal/scope-lists.tsx`, side-by-side "In the signed scope"/"Not included" columns, an excluded change-request-sourced item showing `changeRequestTitle`). F012's own RLS/schema already covered the table itself (its own handoff's AS-043 tests); this feature adds the write path and both UIs. Re-verified by re-running `tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts`'s AS-043 block unchanged (2 tests).
AS-044: PASS — a project can record decisions with rationale, type, date, and a client-visibility flag. Team-side CRUD (`createDecision`/`updateDecision`/`deleteDecision`) plus the "Turn into decision" affordance in `components/task/comment-list.tsx` (`createDecisionFromComment`, carrying the comment's own text/author/date and the task's server-resolved phase into a new row, no dialog). Portal read via `components/portal/decision-log.tsx`. Covered by `tests/unit/f015-turn-into-decision.test.ts` (4 tests: button visible for team, hidden for client/viewer, visible-by-default-when-role-unset) and manual/definition-of-done verification (see Notes).
AS-045: PASS — a `client_visible = false` decision is absent from every portal response. Unchanged from F012's own migration/RLS (`project_decisions_select_client`, 20260926010000) — this feature's `getProjectDecisions` read (unmodified) and the new Scope page/`DecisionLog` component render whatever RLS already returns, with no client-side filter that could disagree with the database. Re-verified by re-running F012's own AS-044/AS-045 describe block (unchanged).
AS-046: PASS — a project can record assumptions with a confirmation state, and the client can flag one as incorrect from the portal. Team-side CRUD (`createAssumption`/`updateAssumption`/`deleteAssumption`, confirming/invalidating stamps `confirmed_on`/`confirmed_by_name`). New `flag_assumption_atomic` RPC (`supabase/migrations/20260929010000_f015_flag_assumption_atomic.sql`) is the client-only "Not correct" path — writes `flagged_by_client_at`/`flagged_note`, never `state`, writes an `audit_log` row, and notifies every active non-viewer/non-client workspace member. Portal UI: `components/portal/assumption-list.tsx` (a dialog captures the required note; a flagged-and-still-`assumed` row is highlighted). Covered by `tests/integration/f015-flag-assumption-atomic.test.ts` (8 tests: client can flag without changing state, audit row written, team notification created and excludes the client, empty note rejected, a team member cannot call it, a caller with no project membership is rejected, a client on a portal-disabled project is rejected, re-flagging twice never touches `state`).

## Files changed
supabase/migrations/20260929010000_f015_flag_assumption_atomic.sql
lib/validation/project-records.ts
lib/actions/project-records.ts
lib/actions/portal-project-records.ts
lib/queries/project-records.ts
lib/supabase/database.types.ts
components/project/record-panel.tsx
components/project/project-settings-nav.tsx
components/task/comment-list.tsx
components/portal/scope-lists.tsx
components/portal/decision-log.tsx
components/portal/assumption-list.tsx
components/portal/change-requests-table.tsx
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/record/page.tsx
app/(portal)/portal/[workspaceSlug]/p/[projectId]/scope/page.tsx
tests/integration/f015-flag-assumption-atomic.test.ts
tests/unit/f015-turn-into-decision.test.ts

## Commands run
`npm run db:apply -- supabase/migrations/20260929010000_f015_flag_assumption_atomic.sql` (0)
`npm run db:gen-types` (0)
`npx tsc --noEmit` (0)
`npx eslint <every file in Files changed above>` (0, one pre-existing-pattern warning fixed inline — an unused `outsiderId` in my own new test file, removed)
`npx vitest run tests/unit/f015-turn-into-decision.test.ts tests/unit/comment-list.test.ts` (0, 12 passed)
`npx vitest run tests/integration/f015-flag-assumption-atomic.test.ts` (0, 8 passed, against the real CLI-linked Supabase project)
`npx vitest run tests/integration/f012-deliverables-scope-decisions-assumptions-rls.test.ts tests/integration/f003-portal-shell.test.ts components/portal/portal-sidebar.test.tsx` (0, 44 passed — side-effect verification: F012's own AS-043/044/045/046 table+RLS tests, the portal shell, and the sidebar nav all still pass unchanged)

Only the tests relevant to this feature plus the definition of done's own side-effect suites were run, not the full vitest suite, per instructions.

## Decisions made
- **"Turn into decision" has no dialog.** The spec's own reasoning for the whole feature ("a dialog per row would guarantee nobody writes them") applies doubly to the one affordance the spec calls out by name as deciding whether the feature is used at all. Clicking the button immediately calls `createDecisionFromComment`, which fixes `decision_type = 'content'` (the most common bucket for something that started as a comment) rather than asking the poster to classify it first — every field, including `decisionType`, remains editable afterwards in the Record panel like any other row.
- **The decision's title is derived, not typed.** `titleFromCommentText` (in `lib/actions/project-records.ts`) takes the comment's first line (or the whole text if it's one line), truncated to 140 chars — the comment's full text is preserved verbatim as `rationale`, so nothing is lost, only summarised for the log's own title column.
- **The task's phase is resolved server-side from `taskId`, never trusted from the client** — `loadTaskExtraForComment` looks it up the same "look the task up yourself" way `loadDeliverableExtra`/`loadScopeItemExtra` etc. all do, matching this repo's established withAuthz convention.
- **`flag_assumption_atomic` is narrower than its sibling `mark_deliverable_delivered_atomic`.** The latter (F014) allows any active project member (team included) to upload a file; this one is deliberately client-only (`is_project_client`), per the spec's own explicit line — a team member who thinks their own assumption is wrong edits the row directly in the Record panel (a normal `is_project_workspace_writer`-gated UPDATE), they don't need a second, client-shaped path to the same columns.
- **"Team notification" (spec's own plural) resolves to every active, non-viewer, non-client member of the project's workspace**, not a single named recipient — unlike `decide_approval_atomic` (which has one natural recipient, `requested_by`), there is no single owner of an assumption in this schema. Implemented as `perform create_notification(...) from workspace_members wm where ...` inside the RPC (valid PL/pgSQL: PERFORM accepts a full SELECT-style query and executes the call once per matched row, discarding the result set) — grepped for precedent (`20260823050000_overdue_notification_sweep.sql`'s `for ... loop` calling `create_notification` per row) and chose the equivalent set-based form since there's no other per-row bookkeeping needed here.
- **`notifications_kind_check` widened** to add `'assumption_flagged'` — same "widen the closed CHECK vocabulary before a new RPC can call `create_notification` with it" step `20260916010000` took for `'approval_decided'`.
- **The Scope view's "Change requests" table renders no price/estimate column at all** (not even an empty one) — this feature's own explicit instruction ("an empty price column reads as 'free'"). `getProjectChangeRequests` (new, `lib/queries/project-records.ts`) selects only what exists today (title, body, status, desired-by, created); F016 will extend both the query and `ChangeRequestsTable` when it lands the pricing columns.
- **`ProjectScopeItem.changeRequestTitle` is resolved only by the portal-facing `getProjectScopeItems`** (a `client_requests(title)` embed) — the team-side action file's own `toScopeItem` sets it to `null` unconditionally, since the Record panel's own `source` select already conveys "this came from a change request" and doesn't need the linked title inline; only the portal's own spec line ("shows which one") needed the resolved title.
- **No settings-page badge/count was added for the "Record" nav tab or the portal's "Scope & decisions" sidebar item** — grepped `components/portal/portal-sidebar.tsx`; that nav entry has never carried a badge (unlike "Your list"'s `deliverablesPastDue`), and nothing in this feature's spec or assertions calls for one.
- **"Raise a change request from this" (spec's own Team side, F015 section 3) was NOT built.** F016 ("Change requests: triage, quote, gate," the very next feature in `plan.md`) is the feature that actually builds the dialog this action is supposed to open pre-filled — building a button here that opens nothing would be worse than not building it. A flagged-and-unconfirmed assumption IS highlighted in the Record panel (`AssumptionRow`'s `isFlagged` styling + the client's note shown inline), which is the half of that spec line this feature could honestly deliver. See Out-of-scope below.

## Out-of-scope work needed
- F016 needs to add the "Raise a change request from this" action to the Record panel's flagged-assumption highlight (`components/project/record-panel.tsx`'s `AssumptionRow`, `isFlagged` branch) once its own dialog exists — pre-filled with the assumption's `text` and `flaggedNote`, per this feature's own spec section 3. The highlight/note-display half is already built; only the action button is deferred.
- F016 also needs to extend `getProjectChangeRequests` (`lib/queries/project-records.ts`) and `ChangeRequestsTable` (`components/portal/change-requests-table.tsx`) with the estimate/price columns once those exist on `client_requests` — both are written to make that a pure addition (no existing column removed or renamed).
- No reorder (drag/move-up-down) affordance exists on any of the three Record panel lists — F013's deliverables panel has one (via a plain `position` integer swap); scope items/decisions/assumptions were built without it since the spec describes them as "one-line artefacts" browsed as a flat list, not a spec-mandated ordering a client depends on the way phases or deliverables are. Scope items still have a `position` column (F012's own schema) that a future feature could wire up the same way if a PM ever asks for it; new scope items are appended at the end.
- The "Not correct" dialog on the portal has no character-count/length affordance beyond the schema's own 2000-char cap (same bare cap every other free-text field in this mission uses) — not flagged as a gap, just noting the parity choice.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: "Turn into decision" fixes `decision_type = 'content'` rather than prompting for one, to keep the affordance a single click with no dialog — see Decisions made above for the full reasoning; this is the one place this feature's spec names a concrete UX risk ("this is the step where the practice dies") and a dialog would reintroduce exactly that risk for the sake of one enum field that's editable afterwards anyway.
AUTONOMOUS_DECISION: "Team notification" (plural, no named recipient in the spec) resolves to every active non-viewer/non-client workspace member of the assumption's project, not a single person — see Decisions made above.
AUTONOMOUS_DECISION: Did not build the "Raise a change request from this" button, since its destination (F016's dialog) does not exist yet — built everything else that button's own spec line implies (the highlight + note surface) and left the action itself as a named, specific follow-up for F016 rather than building a button that opens nothing.

## Notes for the next worker
- No MCP was used for this feature — per this mission's established convention (restated in F012/F013/F014's own handoffs — "The Supabase MCP is not authorised — use the CLI"), all schema work went through `npm run db:apply`/`npm run db:gen-types` against the CLI-linked project, and the new RPC's authorization behaviour was verified by exercising real signed-in sessions and `.rpc()` calls in `tests/integration/f015-flag-assumption-atomic.test.ts`, the same convention `tests/integration/f014-mark-deliverable-delivered.test.ts` already established.
- `lib/actions/project-records.ts`'s `loadProjectExtra`/`loadScopeItemExtra`/`loadDecisionExtra`/`loadAssumptionExtra`/`loadTaskExtraForComment` are five near-identical "resolve workspace/project + slug via admin client" helpers, matching `lib/actions/deliverables.ts`'s own `loadProjectExtra`/`loadDeliverableExtra` pair one-for-one (not factored into a shared generic — the existing sibling file didn't either, and each one's `.select()` shape and not-found message differs slightly by row type, the same reasoning that file's own header comment gives).
- F016 (next in `plan.md`, M3's last feature) is the one to read this handoff's "Out-of-scope work needed" section closely before starting — both named follow-ups (the change-request pricing columns, the "Raise a change request" button) are its own stated scope already, this just confirms where the seams are.
