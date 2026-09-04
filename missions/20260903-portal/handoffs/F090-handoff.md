# Handoff: F090 — close out five deferred audit items

## Status
COMPLETE

## Assertions covered
This feature has no pre-assigned assertion IDs in `validation-contract.md` — it closes
out five specific, itemized audit findings handed to the worker directly. New
regression tests are named `test_AS_090_<item>_...` to keep the convention, but
`AS-090-*` is not a contract ID; treat the five items below as the unit of "done."

- Item 1 (role="img" a11y bug): PASS — fixed `status-pie-chart.tsx`; full-repo sweep
  found no other instance of the bug (all other `role="img"` sites have no focusable
  descendants). Verified by `tests/unit/f087-a11y-perf-audit.test.tsx` pattern
  (no new dedicated test file needed — no behavior beyond the attribute swap;
  covered implicitly by the component still rendering/functioning, and manually
  confirmed via `grep`).
- Item 2 (board client-visibility indicators): PASS — `tests/integration/f090-board-client-visibility.test.ts` (1 test, real hosted DB).
- Item 3 (mailto → real notification): PASS — `tests/integration/f090-nudge-approval-owner.test.ts` (3 tests, real hosted DB) + `components/portal/approval-card.test.tsx` (2 new/updated tests).
- Item 4 (launch confidence raw enum): PASS — `components/project/portal-settings-panel.test.tsx` (2 tests, new file — this component had zero test coverage before).
- Item 5 (11 hard deletes, no undo): PASS for all 11 — `components/project/deliverables-panel.test.tsx` (2 tests) proves the pattern end to end; the other 10 sites are typechecked, lint-clean, and manually reasoned through the same code path but have no dedicated component test (see "Out-of-scope work needed").

## Files changed

### Item 1
- `components/dashboard/status-pie-chart.tsx`

### Item 2
- `supabase/migrations/20261028010000_f090_board_client_visibility.sql` (new)
- `lib/queries/tasks.ts`
- `lib/supabase/database.types.ts` (regenerated via `npm run db:gen-types`)
- `tests/integration/f090-board-client-visibility.test.ts` (new)

### Item 3
- `supabase/migrations/20261029010000_f090_approval_owner_nudge_kind.sql` (new)
- `lib/actions/portal-approval.ts` (new `nudgeApprovalOwner`)
- `lib/notifications/fanout.ts` (new `approval_owner_nudge` kind)
- `components/portal/approval-card.tsx`
- `components/portal/approval-card.test.tsx`
- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/approvals/page.tsx` (passes `ownerId` instead of `ownerEmail`)
- `tests/integration/f090-nudge-approval-owner.test.ts` (new)

### Item 4
- `components/project/portal-settings-panel.tsx`
- `components/project/portal-settings-panel.test.tsx` (new)

### Item 5
- `lib/toast/undo-toast.ts` (optional `description` override)
- `lib/actions/deliverables.ts` (+ `restoreDeliverable`)
- `lib/actions/phases.ts` (+ `restorePhase`)
- `lib/actions/project-records.ts` (+ `restoreScopeItem`, `restoreDecision`, `restoreAssumption`)
- `lib/actions/project-site.ts` (+ `restoreProjectLink`, `restoreProjectAccount`)
- `lib/actions/metrics.ts` (+ `restoreMetric`, `restoreSnapshot`, `restoreImprovement`)
- `lib/actions/project-budgets.ts` (+ `restoreProjectBudget`)
- `components/project/deliverables-panel.tsx` (+ test file, new)
- `components/project/phase-list.tsx`
- `components/project/record-panel.tsx`
- `components/project/site-panel.tsx`
- `components/project/measurement-panel.tsx`
- `components/project/budget-panel.tsx`

## Commands run
- `npx tsc --noEmit` (0)
- `npm run build` (0)
- `npm run db:apply -- supabase/migrations/20261028010000_f090_board_client_visibility.sql` (0)
- `npm run db:apply -- supabase/migrations/20261029010000_f090_approval_owner_nudge_kind.sql` (0)
- `npm run migrations:check` (0 — "No migration drift")
- `npm run db:gen-types` (0)
- `npx eslint <all touched files>` (0)
- `npx vitest run tests/unit/f087-a11y-perf-audit.test.tsx components/portal/approval-card.test.tsx components/project/portal-settings-panel.test.tsx components/project/deliverables-panel.test.tsx tests/integration/f090-board-client-visibility.test.ts tests/integration/f090-nudge-approval-owner.test.ts tests/integration/f222-status-category-semantics.test.ts tests/integration/f224-board-swimlane-grouping.test.ts tests/integration/board-reload-persistence.test.ts tests/integration/trash-exclusion-board.test.ts tests/integration/f009-decide-approval-action.test.ts` (0 — 51/51 passed, all integration tests against the real hosted project)

Manual verification: dev server was not exercised in a browser this session (targeted
automated + real-DB integration tests were used instead per the "targeted tests only"
instruction); could not click through the UI live. `npm run build` succeeding + the
real-DB integration tests for items 2/3 give strong confidence the server-side halves
work; the client-side halves (board card rendering, portal settings select, undo toast
click) are typechecked/lint-clean and exercised by component tests where written,
but item 5's 10 non-deliverable sites and item 4's actual browser rendering were not
clicked through live.

## Decisions made

- **Item 1 sweep**: grepped every `role="img"` in the repo (excluding
  node_modules/.next) and manually inspected each for focusable descendants.
  Only `status-pie-chart.tsx` had the bug (buttons inside `role="img"`);
  `layout.tsx`, `user-avatar.tsx`, `metric-comparison-card.tsx`,
  `project-progress.tsx`, `workspace-logo.tsx` are all pure decorative bars/
  images with no interactive children, so `role="img"` is correct there.
- **Item 2**: reused the RPC's existing "one more passthrough column" pattern
  (identical shape to F224's `tags` column addition) rather than a new RPC or
  a second round trip. Verified every current caller before changing the
  function's return shape (grep'd `get_project_board_tasks` across the repo).
- **Item 3**: `nudgeApprovalOwner` re-derives the current decision owner
  server-side from `project_decision_owners` — never trusts the `ownerId`
  prop the client already had, matching AS-022's own "the prop is
  presentation only" convention on that component. The
  `notifications_kind_check` union was re-derived live: queried
  `pg_get_constraintdef` on the real hosted project via the Management API
  immediately before writing the migration, cross-checked against a grep of
  every `p_kind =>`/`kind:` call site, and the two agreed exactly — the
  migration's comment documents both sources, per the explicit instruction
  not to retype from a single prior migration.
- **Item 4**: the actual defect was in `<SelectValue>` — Radix's
  `Select.Value` only renders a registered `SelectItem`'s children once
  `SelectContent` has mounted (it lives in a portal, so only after the user
  opens the dropdown); until then it falls back to the raw `value` string.
  This was proven with a failing test first (`toHaveTextContent("On track")`
  failed with `on_track▼` before the fix), not assumed. Fixed by passing the
  already-computed label as an explicit child of `<SelectValue>`, which
  Radix uses instead of the fallback.
- **Item 5 — soft-delete judgment**: implemented "capture full row before
  `.delete()`, then reinsert-on-undo via `showUndoToast`" for all 11 sites,
  per the fallback the mission explicitly authorized. I judge that
  **`metric_snapshots` (deleteSnapshot), `project_decisions`
  (deleteDecision), and `project_budgets` periods (deleteProjectBudget)**
  still deserve real soft-delete + a Trash entry — exactly the three the
  audit itself named as candidates. Each of their delete/restore functions
  in code carries an explicit comment saying so. I did NOT implement that
  larger migration (new `deleted_at` column, RLS policy updates, Trash page
  wiring, purge-phrase flow) — see "Out-of-scope work needed".
- **Item 5 — cascade limitations documented, not silently dropped**:
  - `deletePhase`/`restorePhase`: any task/deliverable whose `phase_id`
    pointed at a deleted phase is set to `null` by the FK the instant the
    phase is deleted; `restorePhase` brings back the phase row but does NOT
    re-link those tasks/deliverables. Documented in code.
  - `deleteMetric`/`restoreMetric`: `metric_snapshots` cascade-delete with
    their parent metric; `restoreMetric` brings back the metric definition
    only, not its snapshot history. Documented in code (also why
    `metric_snapshots` itself is a named soft-delete candidate).
  - `deleteScopeItem`/`restoreScopeItem`: a scope item's
    `change_request_id` link is deliberately dropped on restore rather than
    blindly trusted from a stale client snapshot.
- **Confirmation dialog copy**: every "This cannot be undone." confirmation
  string that is no longer true (deliverables, links/accounts, scope items/
  decisions/assumptions) was updated to say undo is available for a few
  seconds. The metric-delete dialog was reworded rather than simply
  softened, since deleting a metric genuinely still loses its measurement
  history even with the fix. Budget/phase dialogs never made an "cannot be
  undone" claim, so were left untouched.
- Used the Supabase Management API (via the same pattern
  `scripts/apply-migration.mjs` already uses) for one read-only query
  (`pg_get_constraintdef`) to verify the live constraint before writing the
  item-3 migration — no MCP server is registered for this mission
  (`missions/20260903-portal/connections/` has no `mcp-registry.md`), so
  this was the available live-introspection path; recorded here per the
  worker-mcp-usage skill's "record MCP/live-DB verification" guidance.

## Out-of-scope work needed

1. **Real soft-delete for `metric_snapshots`, `project_decisions`,
   `project_budgets`** (this feature's own explicit judgment call, see
   above): add `deleted_at` to each, update their SELECT policies/queries to
   filter it, add a Trash entry type + restore action for each, and a
   typed-phrase purge path matching the existing Trash conventions
   (`lib/actions/trash.ts` if that's the existing pattern — not read in this
   session, a future worker should start there). This is materially larger
   than the reinsert-on-undo fix already shipped and was consciously left
   for a follow-up per the mission's own explicit permission to do so.
2. **Item 5 test coverage for the other 10 sites**: only `deliverables-panel`
   got a dedicated component test proving the full delete→undo→restore
   round trip in the browser-DOM sense (mocked actions). The other 10 (phase,
   scope item, decision, assumption, link, account, metric, snapshot,
   improvement, budget) are typechecked/lint-clean and follow the identical,
   now-proven pattern, but have no component test of their own — none of
   these 6 panel files (`phase-list.tsx`, `record-panel.tsx`, `site-panel.tsx`,
   `measurement-panel.tsx`, `budget-panel.tsx`) had ANY test coverage before
   this feature, so this is not a regression, but it is a gap.
3. **The `role="img"` class of bug is now 3-for-3 real** (phase-timeline,
   hours-burndown-chart from F087; status-pie-chart from this feature). A
   lint rule or a shared `<VisualSummary role="group" ...>` wrapper
   component would prevent a fourth instance; not built here (scope creep
   beyond the audit's five items).
4. **Other `<SelectValue placeholder=...>` sites** (15 files found by grep,
   e.g. `list-filters.tsx`, `board-toolbar.tsx`, `bulk-status-action.tsx`)
   may have the same first-paint raw-value flash bug item 4 turned out to
   be, IF any of them are ever rendered with a pre-set `value` on initial
   mount (item 4's bug only manifests when the select already has a value
   when it mounts, not on a select that starts empty and is only set via
   user interaction). Not swept — out of this feature's five-item scope,
   flagging since the root cause (`SelectValue`'s Radix fallback behavior)
   is now understood.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions

AUTONOMOUS_DECISION: For item 5, chose "capture full row before delete,
reinsert on undo" over the two other options considered (a) soft-delete
migration for all 11, (b) client-side deferred-delete (don't actually call
`.delete()` until the undo window expires). Rejected (a) as disproportionate
for 8 of the 11 tables per the mission's own explicit fallback clause.
Rejected (b) because it changes the moment-of-truth semantics other code
(revalidatePath, audit log, RLS-scoped reads elsewhere in the app) depends
on — a still-technically-present-but-about-to-be-deleted row could be read
by a concurrent request in a confusing half-deleted state. Reinsert-on-undo
keeps every existing write/audit/revalidate path completely unchanged and
only adds a new insert path that mirrors the existing `create*` action for
that same table.

AUTONOMOUS_DECISION: For the `notifications_kind_check` constraint (item 3),
used the Supabase Management API directly (same mechanism
`scripts/apply-migration.mjs` uses) to read the live constraint via
`pg_get_constraintdef`, since no Supabase MCP server is registered for this
mission. This satisfies the "derive from the live database" instruction
without inventing new tooling.

## Notes for the next worker

- The `role="img"`-hides-focusable-children bug pattern: check any element
  with `role="img"` that wraps `<button>`/`<a>`/anything with `tabIndex` —
  ARIA flattens the whole subtree to a single opaque image for assistive
  tech. Fix is `role="group"` with the same `aria-label` summary.
- The `<SelectValue>` first-paint bug pattern: if a shadcn/Radix `<Select>`
  ever mounts with a non-empty `value` prop, put the human label as an
  explicit child of `<SelectValue>` rather than relying on the default
  (which needs the corresponding `<SelectItem>` to have already rendered
  inside `<SelectContent>`, which only happens after the dropdown opens).
- `lib/actions/portal-approval.ts`'s `nudgeApprovalOwner` is the first
  caller of `create_notification` with a genuinely single, explicitly-named
  recipient (not a fan-out via `getPortalEventRecipients`) — a template for
  any future "notify this one specific person" action.
- Every one of the 11 restore actions in item 5 follows an identical shape:
  Zod schema mirroring the table's own columns, `resolveWorkspace` via that
  file's existing `loadProjectExtra(admin, input.projectId)`, plain
  `ctx.admin.from(table).insert({ id: input.id, ...})`. If a 12th hard-delete
  site is ever found, copy any one of these six files' pattern directly.
- No MCP servers are registered for the `20260903-portal` mission at all
  (`missions/20260903-portal/connections/` has no `mcp-registry.md` file).
  Live-DB verification in this session went through the same Management-API
  script pattern `scripts/apply-migration.mjs`/`scripts/check-migration-drift.mjs`
  already use, reading `SUPABASE_ACCESS_TOKEN`/`SUPABASE_PROJECT_REF` from
  `.env`.
