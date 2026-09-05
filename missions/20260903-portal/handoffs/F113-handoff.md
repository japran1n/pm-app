# Handoff: F113 — Design and staging links, first-class (client portal phase 2, item B)

## Status
COMPLETE

## Assertions covered
No feature spec file (`F113-*.md`) existed for this work — it was assigned directly by the
orchestrator's prompt referencing `docs/client-portal-phase-2-plan.md` item B, outside the
normal `/mission-tasks` clarification flow, and the validation contract (`missions/20260903-portal/validation-contract.md`)
has no assertion ID in this range (it stops at AS-055; this is a post-approval phase-2 addition
with no contract update performed by the orchestrator). Per validation-contracts skill rules, I
did not invent or renumber a contract entry myself. I am reporting against a self-assigned
tracking ID (AS-113) used consistently across code comments/tests/commit message, and the
orchestrator should append it to the contract as a new assertion if this work is meant to be
tracked going forward:

AS-113 (self-assigned, not yet in validation-contract.md): A project can record a Figma frame,
staging URL and live URL per page (task), each independently client-visible, alongside the
project-level Figma/staging/live strip; a client reads only client-visible links on
client-visible pages of a portal-enabled project. — PASS, verified live:
- `npx vitest run tests/integration/f113-page-links-rls.test.ts` — 14/14 passing, including the
  cross-project RLS case (client A cannot read project B's page link by direct id or by task
  filter), the "client_visible link on a non-client-visible task must not leak" case, the
  credential-shaped URL rejection (CHECK violation), and the "page with no links" empty case for
  both team and client sessions.
- `npx vitest run tests/unit/f113-page-links-validation.test.ts` — 8/8, covering the Zod schema's
  credential-shape refusal (page_links AND the retrofit onto project_links.url) and the shared
  kind vocabulary.
- `npx vitest run components/portal/portal-link-strip.test.tsx components/portal/page-links-menu.test.tsx components/portal/pages-table.test.tsx` — 11/11 (pages-table's own pre-existing 6 tests untouched/still green, proving the new `linksByPageId` prop is backward-compatible).
- Live curl against the dev server (see Commands run) confirms real markup: the topbar strip
  renders `portal-link-strip-staging`/`portal-link-strip-live` chips, and every one of the six
  seeded Website Redesign pages renders exactly one `page-links-menu-trigger`.

## Files changed
supabase/migrations/20261101020000_f113_page_links.sql
supabase/migrations/20261101030000_f113b_link_kind_guard_execute_grant.sql
lib/queries/page-links.ts
lib/validation/page-links.ts
lib/actions/page-links.ts
lib/validation/project-site.ts (added credential-shape guard to project_links.url)
components/portal/portal-link-strip.tsx
components/portal/portal-link-strip.test.tsx
components/portal/page-links-menu.tsx
components/portal/page-links-menu.test.tsx
components/portal/pages-table.tsx (added optional `linksByPageId` prop + Links column)
components/task/page-links-editor.tsx
components/task/task-detail-sheet.tsx (renders PageLinksEditor for page-type tasks)
components/portal/portal-topbar.tsx (renders PortalLinkStrip via optional `keyLinks` prop)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/layout.tsx (fetches & passes keyLinks)
app/(portal)/portal/[workspaceSlug]/p/[projectId]/pages/page.tsx (fetches & passes linksByPageId)
scripts/seed-demo.mjs (Website Redesign pages seeded with Figma + staging page_links)
tests/integration/f113-page-links-rls.test.ts
tests/unit/f113-page-links-validation.test.ts
lib/supabase/database.types.ts (regenerated, additive only — includes page_links)

## Commands run
`npm run db:apply -- supabase/migrations/20261101020000_f113_page_links.sql` (0)
`npm run db:apply -- supabase/migrations/20261101030000_f113b_link_kind_guard_execute_grant.sql` (0)
`npm run db:gen-types` (0, run twice, final output clean)
`npm run migrations:check` (0 — "No migration drift — all migrations present on remote.")
`npm run seed:demo` (0, run TWICE in a row — both runs produced identical output and identical
  `page_links` row count of 12 for Website Redesign, 2 per page × 6 pages — proving idempotency)
`npx tsc --noEmit` (0)
`npm run build` (0 — Turbopack build succeeded; see Notes for a transient unrelated failure)
`npx vitest run tests/unit/f113-page-links-validation.test.ts tests/integration/f113-page-links-rls.test.ts components/portal/portal-link-strip.test.tsx components/portal/page-links-menu.test.tsx components/portal/pages-table.test.tsx tests/unit/server-client-boundary-imports.test.ts tests/unit/f022-project-accounts-credential-guard.test.ts` (0 — 46/46 passing)
`curl -b <cookies> http://localhost:3000/dev-login?email=nina@demo.test` then
  `curl -b <cookies> http://localhost:3000/portal/acme-studio/p/a516905b-eb8a-4b4e-955b-844a546df9df/pages`
  → 200, real markup: 6× `data-testid="page-links-menu-trigger"`, one
  `data-testid="portal-link-strip-staging"` and one `data-testid="portal-link-strip-live"` chip
  in the topbar (see Notes on why "live" renders instead of "not live yet" for this particular
  demo project).
`curl -b <cookies-as-sasa> http://localhost:3000/w/acme-studio/projects/a516905b-eb8a-4b4e-955b-844a546df9df/list` → 200

## Decisions made
- **No MCP usage this session.** `missions/20260903-portal/connections/mcp-registry.md` marks
  Supabase with `Worker use: yes`, but this feature's schema introspection was done via direct
  SQL migration authoring + `npm run db:apply`/`db:gen-types` (the project's own established
  pattern for this mission, matching F022's own file headers), not via Supabase MCP tools — no
  MCP server was invoked because the repo's own scripted apply/verify path already gives an
  authoritative, auditable result and the task didn't need live policy/config introspection
  beyond what the migration file itself states.
- **Project-level strip placement: the portal topbar, not "Your site".** Argued in the spec
  prompt's own terms: "Your site" is the durable full-list home (kept unchanged, still lists
  every link including sitemap/drive/analytics), but a client checking the staging URL while
  reviewing Approvals or Pages shouldn't have to navigate away first. The topbar is rendered
  unconditionally on all eleven routes under the portal shell (`portal-topbar.tsx`'s own header
  comment), so "same place every visit" is true by construction, not by convention.
- **`page_links` keyed on `task_id`, sharing `project_links`' kind vocabulary via one new
  function (`is_valid_link_kind`)** rather than duplicating the inline CHECK list. Both tables'
  CHECK constraints now point at the same function, so a future kind never drifts between them —
  verified by grep: `project_links_kind_check` and `page_links_kind_check` both call
  `public.is_valid_link_kind(kind)` (supabase/migrations/20261101020000_f113_page_links.sql).
- **RLS on `page_links` requires the PARENT TASK to be `client_visible`, not only the link row's
  own flag.** A link marked client-visible on a task the client can't see must not leak the
  task's existence — covered by its own failure test
  (`tests/integration/f113-page-links-rls.test.ts`, "a client-visible link on a NOT client-visible
  task does not leak").
- **One "Links" affordance per Pages table row (a dropdown menu), not one icon per link kind** —
  the spec's own explicit instruction ("a row with three link icons is worse than a row with one
  affordance"). Reused the existing `DropdownMenu` primitive (Base UI) rather than a new popover
  pattern; `render={<a .../>}` (Base UI's `render` prop, not Radix's `asChild`) was required —
  discovered by grepping `components/workspace-switcher.tsx` for the codebase's own precedent.
- **Team-side per-page editing lives inside the task detail sheet**, gated on
  `task.taskTypeSystemKey === "page"` — the exact same gate the pre-existing Page slug/order
  fields use, directly above it in the same file. Chose this over a separate settings screen per
  the spec's own suggestion ("a page's Figma link belongs with the page"), and it required no new
  route or page-fetching plumbing: `PageLinksEditor` fetches its own data via a server action on
  mount, mirroring this same file's pre-existing `getProjectPhaseOptions` precedent (see that
  effect a few hundred lines above my own change) rather than the Server-Component-fetches
  convention that would apply to a page-level component.
- **Credential guard applied to `project_links.url` too**, per the spec's explicit "while you are
  there" instruction — both the CHECK constraint (migration) and the Zod schema
  (`lib/validation/project-site.ts`) now share the identical `looksLikeCredential`/
  `looks_like_credential` rule `project_accounts` already had.
- **No reorder action for `page_links`.** A page has at most one link per kind in practice
  (three fixed rows: Figma/staging/live in the editor); `project_links`' manual reorder exists
  for an open-ended per-project list, which `page_links` deliberately isn't.
- **AS-113 self-assigned, not added to `validation-contract.md`.** The validation-contracts skill
  says new assertions get new IDs and new features in `plan.md`, both of which are orchestrator
  actions on the immutable, already-`APPROVED` contract — a worker must not edit that file. I used
  a self-consistent ID across code, tests and the commit message so a future worker/validator can
  find every reference by grepping "AS-113", and flagged this gap explicitly above and in
  Out-of-scope work needed.

## Out-of-scope work needed
- **Orchestrator: append AS-113 (or a properly-numbered equivalent) to
  `missions/20260903-portal/validation-contract.md` and `plan.md`** if this phase-2 item is meant
  to be tracked by the normal contract/milestone process — I did not do this myself (worker,
  immutable-contract rule).
- **Demo data nuance, not a defect:** `WEBSITE_LINKS` (pre-existing, F022's own seed data, NOT
  touched by me) marks Website Redesign's project-level `live` link as `clientVisible: true` even
  though the project hasn't launched (`target_launch_date` is 30 days out). This means the
  topbar's "Not live yet" honest placeholder — which I built and unit-tested correctly (see
  `portal-link-strip.test.tsx`) — will NOT be the state a screenshot of Website Redesign shows;
  it'll show a real "Live site" chip instead, because the pre-existing seed row says the link
  already exists. To see the "Not live yet" placeholder live, either seed a project with a
  portal-enabled, un-launched state and NO `live`-kind `project_links` row, or temporarily delete
  Website Redesign's `live` row. I did not change `WEBSITE_LINKS` myself since it predates this
  feature and touching it risks contradicting an earlier feature's own demo narrative.
- **item C ("What happens next")** and **item A (chat)** from the same plan doc remain entirely
  unimplemented — explicitly out of this feature's scope (item B only).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: No feature-spec file or clarification file existed for this work (it was
handed to me directly via the orchestrator's prompt, referencing the plan doc rather than a
`missions/20260903-portal/features/F113-*.md` + `clarifications/F113-clarification.md` pair). I
treated the prompt itself, `docs/client-portal-phase-2-plan.md` section B, and the existing F022
implementation (`project_links`/`project_accounts`) as the source of truth, per the ZERO_QUESTIONS
priority order (clarified spec → clarification file → tech-decisions → safest default). Every
design choice the prompt asked me to "decide and defend" is recorded under Decisions made above.

AUTONOMOUS_DECISION: Migration filenames use `20261101020000`/`20261101030000` (not
`20261101010000`) specifically to avoid a timestamp collision with a concurrent worker's
`20261101010000_f112_project_roles.sql`, discovered mid-session when both workers' processes were
editing the same working tree simultaneously (see Notes below). No content was changed to
accommodate this, only the filename's timestamp component.

## Notes for the next worker
- **This session ran concurrently with another worker (F112 — `project_roles`) in the SAME
  working directory**, confirmed by `git status` showing files I never touched
  (`components/portal/team-card.tsx`, `lib/queries/portal.ts`,
  `app/(workspace)/.../settings/page.tsx`, `tests/unit/portal-overview-queries.test.ts`, and
  `scripts/seed-demo.mjs`'s own `*_PROJECT_ROLES` blocks) changing under me mid-session. A
  `git stash`/`git stash pop` I ran to isolate a transient seed-script failure briefly swept up
  both sessions' uncommitted work into one stash; I recovered by diffing the stash against disk,
  restoring only the seven files that were genuinely mine via `git checkout stash@{0} -- <file>`,
  and leaving every F112 file exactly as the other worker's process had it. I also found and
  fixed two duplicate-declaration syntax errors in `scripts/seed-demo.mjs`
  (`WEBSITE_PROJECT_ROLES`/`NORTHWIND_PROJECT_ROLES`/`MERIDIAN_PROJECT_ROLES`, each declared
  twice, presumably from the other worker's own edit landing twice across the stash boundary) —
  fixed via a small idempotent Python dedup script, verified with `node --check` and two full
  `npm run seed:demo` runs. **I did not commit any F112 file** — `git add` was given an explicit
  file list (never `-A`) and I additionally ran `git reset HEAD --` on every F112 path that a
  first `git add` pass had picked up unexpectedly, to double check. `git log -p` on my commit
  (bc93503) should be checked once more downstream to confirm zero F112 files landed in it if
  there's any doubt.
- `npm run build` failed once mid-session with a server/client boundary error inside
  `components/project/project-roles.tsx` → `lib/queries/project-roles.ts` → `lib/supabase/server.ts`
  — entirely the other worker's in-flight code, not mine (confirmed: my new files only ever
  `import type` from `lib/queries/page-links.ts` in client components; the one real runtime import
  is in the Server Component `pages/page.tsx`). By the time I re-ran the build a few minutes
  later it passed cleanly, presumably once F112's own worker fixed it.
- **Screenshot suggestion for the user:** sign in as `nina@demo.test` (dev-login), open
  `/portal/acme-studio/p/<Website Redesign's id>/pages` — you should see a "Links" column with a
  small "Links" pill/button on every row; clicking it opens Figma + Staging for that page. Then
  look at the sticky topbar (visible on that same page, not just "Your site") — it should show a
  "Staging" chip and a "Live site" chip (see Out-of-scope work needed above for why it's "Live"
  and not "Not live yet" on this particular demo project). For the team side, sign in as
  `sasa@demo.test`, open the Website Redesign project's list/board view, open the "Homepage" task
  — a "Page links" box should appear beneath the existing Page slug/order fields, with three rows
  (Figma frame / Staging URL / Live URL) pre-filled for Figma and Staging, empty for Live, each
  with its own "Client-visible" checkbox.
