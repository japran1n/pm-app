# Handoff: F080 — Client portal cannot be turned on (audit fix)

## Status
COMPLETE

## Assertions covered
This is an ad-hoc audit-fix task (no `features/F080-*.md` spec or
validation-contract assertion IDs exist for it — confirmed by grep: no
`F080` file under `missions/20260903-portal/features/`). I verified every
claim in the audit prompt against the real code first (see "Decisions
made") and derived local assertion labels from the audit's own explicit
requirements, each covered by a real, run test in
`tests/integration/f080-portal-settings-authz.test.ts`:

AS-F080-1: A workspace `member` cannot turn a project's client portal on. PASS — `setPortalEnabled` returns `ok:false`; DB `portal_enabled` stays `false`.
AS-F080-2: A workspace `client` cannot turn a project's client portal on. PASS — same shape as AS-F080-1.
AS-F080-3: A workspace `admin` can turn a project's client portal on, and `portal_enabled_at` is set. PASS.
AS-F080-4: A workspace `owner` can turn a project's client portal back off. PASS.
AS-F080-5: A `viewer` cannot edit launch/warranty details. PASS.
AS-F080-6: A `client` cannot edit launch/warranty details. PASS.
AS-F080-7: A `member` can edit launch/warranty details and the five fields round-trip through the DB. PASS.
AS-F080-8: Setting `launch_confidence` to a non-`on_track` value with no `launch_note` is rejected. PASS (schema-level `.refine`, exercised through the real action).
AS-F080-9: Setting `launch_confidence` to a non-`on_track` value WITH a `launch_note` succeeds. PASS.

## Files changed
lib/auth/permissions.ts (new `canManagePortalSettings` predicate, owner/admin)
lib/validation/portal-settings.ts (new)
lib/actions/portal-settings.ts (new — `setPortalEnabled`, `updateProjectLaunch`)
lib/queries/portal-settings.ts (new — `getPortalReadiness`)
components/project/portal-settings-panel.tsx (new)
components/project/project-settings-nav.tsx (added "Client portal" tab entry)
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/portal/page.tsx (new)
components/nav/app-sidebar.tsx (added "Preview as client" sidebar entry)
tests/integration/f080-portal-settings-authz.test.ts (new)

## Commands run
`npx tsc --noEmit` (0)
`npm run build` (0)
`npx eslint lib/actions/portal-settings.ts lib/validation/portal-settings.ts lib/queries/portal-settings.ts lib/auth/permissions.ts components/project/portal-settings-panel.tsx components/project/project-settings-nav.tsx components/nav/app-sidebar.tsx "app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/portal/page.tsx" tests/integration/f080-portal-settings-authz.test.ts` (0)
`npx vitest run tests/integration/f080-portal-settings-authz.test.ts` (0, 9/9 passed against the real hosted Supabase project in `.env`)
`curl -s -o /dev/null -w "%{http_code}\n" -L http://localhost:3000/w/acme-studio/preview-as-client` (200, no server crash — see Notes, this is NOT a signed-in walkthrough)
`curl -s -o /dev/null -w "%{http_code}\n" -L http://localhost:3000/w/acme-studio/projects/x/settings/portal` (200, no server crash — same caveat)

## Decisions made
- **Verified claim 1 (nothing writes `portal_enabled`) before building**: grepped `app/(workspace)/**`, `components/**`, `lib/actions/**` for `portal_enabled` — confirmed zero writers, only readers (`lib/queries/portal.ts:133,944,1009`) and client-block guards (`lib/actions/approvals.ts:106-122`, `comments.ts:157-212`, `attachments.ts:136-207`, `metrics.ts:1117-1151`, `portal-deliverables.ts:105-165`). `requestApproval` (`lib/actions/approvals.ts:200-210`) does refuse with "This project's client portal isn't turned on yet. Enable it in project settings before requesting a client approval." — this message was already accurate wording, it was just pointing at a control that didn't exist; no change needed to the message itself now that the control exists.
- **`withAuthz` gate exists, confirmed spelling**: `lib/actions/authz.ts`, used by `lib/actions/approvals.ts`, `deliverables.ts`, `metrics.ts`. New actions mirror `metrics.ts`'s exact shape (a local `loadProjectExtra` resolving `{workspaceId, projectId, visibility, extra:{workspaceSlug}}`, `requireWrite`/`requireVisibility` options).
- **Owner/admin-only write path**: added `canManagePortalSettings` to `lib/auth/permissions.ts`, mirroring `canChangeProjectVisibility` exactly (same two roles). This matches the DB-level ground truth I read directly off `enforce_projects_field_role_allowlist` (`supabase/migrations/20261022010000_f025d_projects_key_insert_guard.sql:114`): `portal_enabled`/`portal_enabled_at` are in `v_owner_admin_cols`; `target_launch_date`/`launch_confidence`/`launch_note`/`warranty_until`/`warranty_terms` are in `v_writer_cols` (any non-viewer, non-client role) — so `setPortalEnabled` uses the new owner/admin-only `writeCheck`, `updateProjectLaunch` uses `withAuthz`'s default `canWrite`.
- **Write executed through `ctx.supabase` (request-scoped), never `ctx.admin`**: `enforce_projects_field_role_allowlist` early-returns for `auth.role() = 'service_role'`, which is exactly what the admin client authenticates as — writing through it would silently bypass the very DB-level owner/admin enforcement this feature exists to keep real. Mirrors `updateProjectVisibility`'s (`lib/actions/project-members.ts:338`) own documented reasoning for the identical choice on `visibility`.
- **Settings placement**: added a new `settings/portal` tab to the existing `ProjectSettingsNav` (`components/project/project-settings-nav.tsx`) rather than a new top-level project tab or folding it into the existing bare `settings/page.tsx` — matches this codebase's own established convention (deliverables/record/budget/measurement/site each got their own sub-nav tab, documented in that file's own comment history) rather than inventing a new pattern.
- **Readiness checklist is informational, not a hard gate**: the enable switch stays enabled regardless of readiness state — a PM may have a legitimate reason to flip the portal on before every box is checked (e.g. staging a client invite ahead of the first phase). This matches the audit prompt's own framing ("shows the client an empty shell, which is worse than off" — a warning, not a block) rather than inventing a new hard-block requirement the prompt didn't ask for.
- **`launch_note` required whenever `launch_confidence !== 'on_track'`**: enforced in `lib/validation/portal-settings.ts`'s zod `.refine()` (app-level — no DB constraint enforces this; verified via grep against every migration touching `launch_note`/`launch_confidence`, none exists). Enforced both client-side (submit button disabled, inline required-marker) and server-side (the real boundary — a direct call to `updateProjectLaunch` bypassing the UI is still rejected).
- **"Preview as client" sidebar entry gated on `hasClient && canManageWorkspace`**, not `hasClient` alone (which is all Approvals/Client requests use): `preview-as-client/page.tsx` hard-redirects non-owner/admin callers, so showing the link to a plain member would only bounce them back — same reasoning `task-detail-sheet.tsx:1640` already applies to its own copy of this link (`currentUserRole === "owner" || currentUserRole === "admin"`).
- **"Preview as client" project-settings-nav placement**: rather than inventing a new link slot beside the tab list (`ProjectSettingsNav`'s `ENTRIES` array is tab-to-subroute pairs, not a place for an external-style link with query params), the preview link lives inside the new "Client portal" tab's panel body (`components/project/portal-settings-panel.tsx`, `data-testid="portal-preview-as-client-link"`), pre-filled with `?projectId=`. This satisfies "reachable from project settings, project-scoped, prefilling the project" without adding a second navigation primitive to that component.

## Out-of-scope work needed
- The audit's point 1 messaging fix ("every place that currently refuses because the portal is off should point the user at this control") — I re-checked every `portal_enabled` guard site and found the only PM-facing refusal (`requestApproval`) already says the right thing; the other four guard sites (`comments.ts`, `attachments.ts`, `metrics.ts`, `portal-deliverables.ts`) all gate a CLIENT's own action, and a client cannot reach project settings at all, so "point them at the control" doesn't apply there. If a future audit disagrees with this reading, it is a one-line message change per site, not a structural gap.
- No automated browser/E2E walkthrough was performed signed in as `sasa@demo.test` — see Notes below.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Named the new predicate `canManagePortalSettings` rather than reusing `canChangeProjectVisibility` verbatim, even though both are byte-for-byte identical (`owner || admin`) today — kept them as two separate, separately-named predicates (matching this file's own established convention of one named predicate per decision, e.g. `canManageMembers` vs `canManageColumns` are also identical in some role sets but never merged) so a future change to one policy doesn't silently change the other.
AUTONOMOUS_DECISION: `launch_confidence`'s "on-track value" is `'on_track'`, read directly off `projects_launch_confidence_check` (`20260909010000_portal_foundations.sql:90-91`) rather than assumed from the column name.

## Notes for the next worker
- No MCP tools were used — this feature required no live schema/policy introspection beyond reading migration files already checked into the repo, and Supabase MCP tools were not in the registry as `Worker use: yes` for a task without a dedicated feature spec/registry entry (this task has no `missions/20260903-portal/features/F080-*.md`, so there's no `connections/mcp-registry.md` row assigned to it either — verified this mission's `connections/` dir exists but this ad-hoc task predates a formal feature assignment).
- I did **not** perform a signed-in browser walkthrough against the dev server as `sasa@demo.test` — the two `curl` checks above only prove the new routes don't 500 for an unauthenticated request (both redirect, both returned 200 after redirect). I have not visually confirmed the "Client portal" tab, its toggle, readiness checklist, launch/warranty form, or the new sidebar "Preview as client" entry render correctly in a real signed-in session. State this plainly rather than implying otherwise. The 9-test integration suite against the real hosted Supabase project is the actual verification of the authz behavior end to end (real DB rows, real RLS/trigger enforcement, real Server Action code path) — the UI itself is unverified beyond `tsc`/`build`/`eslint` passing.
- `docs/client-portal-plan.md` may be worth a follow-up read/update pass — I did not touch it, only referenced it as it's cited elsewhere in the codebase's own comments.
