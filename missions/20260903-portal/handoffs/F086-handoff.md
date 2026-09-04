# Handoff: F086 — Demo readiness (second workspace, second client, project-state coverage, demo script)

## Status
COMPLETE

## Assertions covered
This feature is not tied to `validation-contract.md` assertion IDs — it is
a demo-data/readiness task scoped to `scripts/seed-demo.mjs` and
`docs/demo-script.md`, per the brief in
`docs/portal-timeline-review-and-demo-readiness.md` Part 4. No AS-NNN IDs
are assigned.

## Files changed
scripts/seed-demo.mjs
docs/demo-script.md
missions/20260903-portal/handoffs/F086-handoff.md

## Commands run
`node --check scripts/seed-demo.mjs` (0)
`npx eslint scripts/seed-demo.mjs` (0, no output)
`npm run seed:demo` (0) — run twice, identical console output both times
`node --env-file=.env -e '<row-count verification script>'` (0) — see Decisions made for counts

## Decisions made

- **Second workspace ("Cedarwood Partners")**: different sector (ops/finance
  consulting vs. Acme's web/brand/mobile design work), different project
  names, different people. `sasa` (owner) belongs to both workspaces —
  real cross-workspace switching for whoever demos. Every other Cedarwood
  account (`ivan`, `petra`) belongs only to Cedarwood; every other Acme
  account (`maja`, `luka`, `ana`, `vuk`, `nina`) belongs only to Acme — the
  boundary is demonstrable in both directions, not just asserted.
- **Second client ("petra@demo.test", Meridian Capital)**: workspace role
  `client`, project member on `Meridian Ops Dashboard` only — not on
  `Meridian Compliance Audit`, which has no client at all. This gives the
  demo three separate "can't see" boundaries to show live: Nina can't
  reach Cedarwood, Petra can't reach Acme, and Petra can't reach
  Cedarwood's other project.
- **Project-state coverage** (existing four projects mostly kept as-is):
  - Healthy burn-down + overdue approval + overdue deliverable: kept
    Website Redesign as-is — it already carries a genuinely overdue
    approval (Site structure sign-off, `dueInDays: -3`) and a genuinely
    overdue, blocking deliverable (Final homepage copy, `dueInDays: -4`)
    alongside its healthy, in-period budget. Building a second, separate
    project purely to re-demonstrate "overdue" would have duplicated
    portal machinery for no new demo value — the brief's bullets describe
    states, not a 1:1 project count, and this project's own portal pages
    already make both overdue items visible on separate screens
    (Approvals vs. Deliverables) from the Hours page's healthy burn-down.
  - Over budget: new project `Meridian Ops Dashboard` (Cedarwood), portal
    enabled with only `project_budgets` seeded (`seedWorkspace2Budget`) —
    20h sold vs. 2100 minutes (35h) already logged across its tasks, so
    `remainingMinutes` in `hours-tiles.tsx` goes genuinely negative rather
    than being forced there. No phases/approvals/deliverables seeded for
    this project — "not every project needs full portal data" per the
    brief, and this project's only demo job is the Hours red path.
  - Launched/finished: new project `Northwind Loyalty App — Phase 1`
    (Acme), every task `done`, dates fully in the past, portal enabled
    with `target_launch_date` in the past, `launch_confidence: on_track`,
    and `warranty_until`/`warranty_terms` filled in. No client account
    attached — reached via staff-side "Preview as client" instead, which
    is also where the demo script sends the presenter (per the brief:
    "the moment you preview as a client").
  - Archived: `Brand Refresh` (Acme, existing project) — added
    `archive: true`, which after task creation sets `deleted_at` +
    `archived_by` the same way `lib/actions/projects.ts`'s
    `archiveProject()` does, and shifted its dates fully into the past so
    "archived" reads coherently against its own timeline instead of an
    archived project with a future end date.
  - Portal switched off: `Mobile App v2` and `Internal Tooling` (Acme,
    existing projects) — never given `portal_enabled: true`, which is
    already the column's own default; documented this explicitly in a
    code comment rather than silently relying on it, since a reader
    scanning for "off" state coverage should find it without having to
    infer it from absence.
- **Refactor, not a rewrite**: extracted the per-project task/checklist/
  comment/time-entry loop that used to run inline in `main()` for
  `PROJECTS` into a shared `seedProjects()` helper, so the same logic seeds
  both Acme's `PROJECTS` and Cedarwood's `WORKSPACE2_PROJECTS` without
  duplicating ~150 lines. Behaviour for the existing four Acme projects is
  unchanged — verified via the "run twice, identical counts" check below,
  and the archived/launched hooks are opt-in per-project flags
  (`spec.archive`, `spec.launched`) so they don't affect any project that
  doesn't set them.
- **Idempotency / wipe**: `wipeWorkspace()` was already generic over a
  `workspaceId` argument and queries `projects` by `workspace_id` with no
  `deleted_at` filter, so the archived Brand Refresh project is still
  found and wiped on the next run — verified live (two consecutive
  `npm run seed:demo` runs produced byte-identical console output,
  including `  ✓ Brand Refresh — archived`). `main()` now wipes both
  workspace slugs (`acme-studio`, `cedarwood-partners`) before recreating
  either, so Cedarwood participates in the same wipe/rebuild cycle Acme
  always has. No new delete added for any table beyond what earlier
  rounds already established — Cedarwood's own rows all cascade from
  `projects`/`workspaces` exactly as documented in the existing FK-cascade
  comment above `wipeWorkspace()`.
- **`WEBSITE_WORK_CATEGORY` / `WEBSITE_EXTRA_TIME_ENTRIES` scoping**: left
  these looked up by task title (unchanged) inside the shared
  `seedProjects()` loop — they only ever match Website Redesign's own task
  titles, so Cedarwood's and the new Acme project's tasks fall through to
  the pre-existing default behaviour (`work_category: null`,
  `billable: visibility === "workspace"`) exactly as every non-Website
  project already did before this change.

## Out-of-scope work needed
- The brief's 4.3 lists "a project with an overdue approval and an
  overdue deliverable" as its own bullet; I treated Website Redesign as
  already covering it (see Decisions made) rather than building a
  dedicated project. If a future reviewer wants a project whose *only*
  job is that state (isolated from Website Redesign's other, healthy
  signals), that would be a small, clearly-scoped follow-up: one more
  `PROJECTS` entry with portal enabled and a minimal
  phases+approvals+deliverables set, no budget/metrics/pages.
- `docs/portal-timeline-review-and-demo-readiness.md` Parts 1–3 (task/phase
  linking gaps, timeline review items) are referenced but out of scope for
  this feature — F086 was scoped to Part 4 only.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "at least one account must belong to only
one [workspace]" as applying to both directions (an Acme-only account and
a Cedarwood-only account), not just one — every account except `sasa` is
single-workspace, which is the strongest, most demoable version of the
boundary.

AUTONOMOUS_DECISION: Gave the launched/finished project no client account
rather than reusing `nina` or adding a third client, since the brief's own
4.4 explicitly calls out "preview as a client" as a demo beat distinct from
signing in as a real client account, and this project's only job is "what
does done look like" — a second full client login added no new demo value
here.

## Notes for the next worker
- Row counts scoped to the two demo workspaces after a fresh run (verified
  identical across two consecutive `npm run seed:demo` runs): workspaces 2,
  workspace_members 10, projects 7 (Website Redesign, Mobile App v2, Brand
  Refresh, Internal Tooling, Northwind Loyalty App — Phase 1, Meridian Ops
  Dashboard, Meridian Compliance Audit), tasks 57 (51 from `PROJECTS`/
  `WORKSPACE2_PROJECTS` + 6 Website Redesign "page" tasks seeded
  separately in `seedPortalDemoData`), project_members 26, project_phases 7
  (Website Redesign only), approval_requests 4, client_deliverables 5,
  project_budgets 2 (Website Redesign + Meridian Ops Dashboard).
- I do not have a browser tool in this environment and could not visually
  drive the dev server to confirm the workspace switcher renders both
  workspaces and switching works end-to-end in the UI. What I *did*
  verify: `components/workspace-switcher.tsx` renders from a
  `workspaces: SwitcherWorkspace[]` prop keyed off active
  `workspace_members` rows (read in the file, not modified), and the seed
  now produces two `active`-status `workspace_members` rows for `sasa`
  (one per workspace) plus a working `/w/[slug]` route for each slug via
  direct Supabase row-count verification above. Please have someone (or a
  UX validator with browser access) do the actual click-through before
  presenting.
- The concurrent agent's changes under `components/portal/**`,
  `lib/queries/portal.ts`, and the portal page files (visible in
  `git status` at the time of this handoff) were left untouched, per
  instruction — this handoff only touches `scripts/seed-demo.mjs`,
  `docs/demo-script.md`, and its own handoff file.
- No MCP tools used — this task only touched a local seed script and a
  markdown demo script; schema facts (column names, CHECK constraints,
  cascade behaviour) came from reading `supabase/migrations/*.sql` and
  `lib/supabase/database.types.ts` directly, and were verified live via
  the admin Supabase client the seed script itself already uses (not a
  separate MCP call).
