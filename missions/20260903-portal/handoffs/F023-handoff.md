# Handoff: F023 — Portal: Your site view

## Status
COMPLETE

## Assertions covered
AS-049: PASS — the view renders links, RLS-scoped by `getProjectLinks`'s own convention (client sees only `client_visible = true` rows). Live test (`tests/integration/f023-site-view-render.test.ts`, `test_AS_049_...`) proves a client session reads exactly the one visible link, that its URL is rendered as a muted mono host label, that `target_blank`/`rel="noopener noreferrer"` are present, and that the hidden link's URL is absent from both the query payload (`JSON.stringify`) and the rendered HTML.
AS-050: PASS — the view renders accounts (owner/status, "keep it plain"). Live test (`test_AS_050_...`) proves a client session reads exactly the one `client_visible` account and the rendered table shows its service/owner label while the hidden account's service name never appears in the output.
AS-051: PASS — the view renders Guides as client-visible `doc_kind = 'training'` docs. Live test (`test_AS_051_...`) proves RLS already excludes the hidden training doc, and that the page's own `doc_kind === 'training'` filter (not RLS) is what excludes an otherwise client-visible `process`-kind doc from Guides; a fourth test proves the empty state reads "Training guides arrive at handover." rather than implying breakage.

## Files changed
supabase/migrations/20261016010000_f023_project_warranty_fields.sql
app/(portal)/portal/[workspaceSlug]/p/[projectId]/site/page.tsx
components/portal/launch-day-card.tsx
components/portal/project-links-list.tsx
components/portal/project-accounts-table.tsx
components/portal/project-guides-list.tsx
components/portal/portal-sidebar.tsx
components/portal/portal-sidebar.test.tsx
tests/integration/f023-site-view-render.test.ts
lib/supabase/database.types.ts (regenerated)

## Commands run
`npm run db:apply -- supabase/migrations/20261016010000_f023_project_warranty_fields.sql` (0)
`npm run db:gen-types` (0)
`npm run migrations:check` (0, no drift)
`npx tsc --noEmit` (0)
`npx eslint components/portal/project-links-list.tsx components/portal/project-accounts-table.tsx components/portal/launch-day-card.tsx components/portal/project-guides-list.tsx components/portal/portal-sidebar.tsx components/portal/portal-sidebar.test.tsx "app/(portal)/portal/[workspaceSlug]/p/[projectId]/site/page.tsx" tests/integration/f023-site-view-render.test.ts` (0 errors)
`npx vitest run tests/integration/f023-site-view-render.test.ts` (0, 4/4 passing against the live Supabase project)
`npx vitest run components/portal/portal-sidebar.test.tsx` (0, 12/12 passing — updated for the removed Files row)
Full vitest suite deliberately NOT run, per instructions.

## Decisions made
- **`warranty_until`/`warranty_terms` added to `projects`** via a new migration (`20261016010000`), since neither existed anywhere in the schema despite the spec naming them as "added here". Role-gated by extending F006k's existing `enforce_project_portal_and_launch_field_role` trigger (`create or replace`, same function, same "writer" bar already applied to `target_launch_date`/`launch_confidence`/`launch_note`) rather than adding a second trigger — one place answers "who can change a project's launch/warranty fields".
- **No `rollback_plan_status`/`monitoring_window` columns exist anywhere in this schema** (grepped: no migration, no query file names either). The launch day card does not invent per-project data for them — it states the two as plain process facts, true for every launch this team runs ("prepared and rehearsed before every launch", "watched closely for the first 48 hours"), never a live per-project status the database doesn't track. This matches the spec's own instruction for the Friday/holiday line: state something true about the process, not fabricate a field.
- **No `duration` column exists on `docs`** (grepped: no migration names one). "as cards with a duration where the doc records one" is honoured by never rendering a duration line at all, since none is ever recorded — not a placeholder or a fake "-".
- **Guide cards render inline (title + content preview), not as a link to a doc detail page.** No portal route for a single doc exists (grepped `app/(portal)` for `docs` — nothing), and the team-only doc editor route a client session cannot reach is out of this feature's own scope to build.
- **Files' row was removed from `buildPortalSecondaryNavItems`; Requests was left in place.** Per the spec's own instruction ("Files belongs here [the site view]. Remove the temporary Files entry ... leave Requests alone, that one is F016's and already lives in Scope"). The "Your site" view's own "More" section now carries the one Files entry point (`data-testid="site-view-files-link"`), and Requests keeps its two entry points (sidebar + this view's own "More" section) until F016 gives it a permanent home in "Scope & decisions".
- **`getAllDocs` is called with `.catch(() => null)`** in the page (it throws on a Postgrest error, unlike `getProjectLinks`/`getProjectAccounts`'s `PortalQueryResult` shape) so a failed docs read degrades to the same "Couldn't load your site" error state as a failed links/accounts read, rather than crashing the page or silently rendering an empty Guides section indistinguishable from "no training docs yet".

## Out-of-scope work needed
- A client-facing single-doc viewer route (so a Guide card could link into the doc's full content rather than a truncated inline preview) — not built here; noted as a gap in "Decisions made" above. A future feature could add `app/(portal)/portal/[workspaceSlug]/p/[projectId]/site/guides/[docId]/page.tsx` reading `getDocById` (already RLS-scoped) if the client-visible preview proves too short in practice.
- `rollback_plan_status`/`monitoring_window` as real per-project fields (rather than the fixed process copy this feature renders) — not requested by the spec's own assertion IDs (AS-049/050/051 cover links/accounts/docs only), but if a future feature wants a PM-editable rollback/monitoring status, it would need new columns on `projects` (or a new table) plus a settings-side control, mirroring how `warranty_until`/`warranty_terms` were added here.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Rendered "rollback plan status" and "monitoring window" as fixed, true-for-every-launch process copy rather than per-project data, since no schema field for either exists and none of this feature's three assigned assertions (AS-049/050/051, all about links/accounts/docs visibility) require them to be dynamic.
AUTONOMOUS_DECISION: Omitted a duration line on guide cards entirely rather than showing a placeholder, since `docs` has no duration column.
AUTONOMOUS_DECISION: Rendered guide cards without a link to a doc detail page, since no client-facing single-doc route exists and building one is out of this feature's scope.

## Notes for the next worker
- No MCP tools were used — the Supabase MCP is not authorised for this mission's workers; schema work went through `npm run db:apply`/`npm run db:gen-types` against the CLI-linked project, and RLS/visibility verification used the same live-signed-session integration-test technique F022's own test file established, extended one layer further into the render components themselves (`renderToStaticMarkup`) so "renders only client-visible" is proven against actual HTML output, not just the query result.
- `components/portal/portal-sidebar.tsx`'s `buildPortalSecondaryNavItems` is now down to one item (Requests). Per its own updated header comment, delete the function and its one remaining call site once F016 lands Requests inside "Scope & decisions" with a real entry point.
