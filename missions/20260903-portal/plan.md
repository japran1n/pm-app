# Mission 20260903-portal — Plan

Build the prototyped client portal for real, plus the team-side surfaces
that produce its data. Email and the extension's client mode are out of
scope (see `description.md`).

**Feature size:** one worker session each (roughly 1–3 h). Features run
serially inside a milestone unless the plan says they are disjoint.

---

## Milestones

| M | Theme | Features | Gate |
|---|---|---|---|
| M1 | Shell, phases, pages | F001–F006 | Client sees the real phase timeline and pages board |
| M2 | Approvals | F007–F011 | A real approval can be raised, decided, and audited |
| M3 | Your list, scope, decisions | F012–F016 | Client obligations and scope are live |
| M4 | Hours and results | F017–F021 | Burn-down and before/after run on real entries |
| M5 | Site, guides, trust | F022–F025 | Preview mode + leak sweep green |

---

## Design constraints (every feature)

1. **Tokens only.** Colors, radii and type come from `app/globals.css`
   and Tailwind. No hex literal, no `px` radius, no inline font stack in
   a component diff. The prototype's CSS is a *specification*, not
   source to paste.
2. **Reuse before building.** `components/ui/*` (shadcn), `EmptyState`,
   `UserAvatar`, `WorkspaceLogo`, `ThemeToggle`, existing table and
   sheet patterns. A second Button is a defect.
3. **Status semantics are added, not invented.** The four state colors
   (waiting / in progress / blocked / done) were validated for contrast
   and colour-vision separation in both themes. Add them once, in
   `globals.css`, as `--status-*` tokens with these values:
   light `#b57a00 / #3670e1 / #b8332a / #12784f`,
   dark `#dbb03e / #7aa5f3 / #dd5560 / #2f9e73`.
   Never re-pick them per component.
4. **State is never colour alone.** Every coloured segment or pill also
   carries a label or a number.
5. **RLS pattern.** Every new client-visible table copies
   `tasks_select_client` (`20260902010000`, hardened `20260902020000`)
   and pins `pg_temp` on SECURITY DEFINER predicates
   (`20260908010000`).
6. **Multi-table writes go through an RPC**, following
   `accept_client_request_atomic` and `approve_portal_task_atomic`.
7. **Server Components fetch; client components receive typed props.**
   Client components never query Supabase directly — the convention
   `lib/queries/templates.ts` documents.

---

## M1 — Shell, phases, pages

### F001 — Migration: portal foundations
**Assertions:** AS-007, AS-008, AS-011, AS-012
**Files:** new migration; `lib/queries/portal.ts`

- `project_phases`: `id`, `project_id`, `name`, `client_description`,
  `position`, `state` (`not_started|active|blocked|done`),
  `planned_start`, `planned_end`, `actual_start`, `actual_end`,
  `client_visible` default true, timestamps.
- `tasks.phase_id` (FK, null), `tasks.page_slug text null`,
  `tasks.page_order int null`.
- `projects.target_launch_date date null`,
  `projects.launch_confidence text null check (on_track|at_risk|slipped)`,
  `projects.launch_note text null`,
  `projects.portal_enabled boolean not null default false`,
  `projects.portal_enabled_at timestamptz null`.
- `project_statuses.client_description text null` — the client-facing
  explanation behind AS-016.
- RLS: client SELECT on `project_phases` requires active membership, the
  `client` role path used by `tasks_select_client`, `client_visible`,
  **and** `projects.portal_enabled`. Team roles unchanged.
- Extend the existing client task policy so `portal_enabled = false`
  hides the project's tasks from clients too (AS-007).
- Seed function `seed_default_phases(project_id)` inserting the ten Good
  Guys phases with their client descriptions.

**Done when:** migration applies via `npm run db:apply`; a client cannot
select phases of a portal-disabled project; `seed_default_phases` on a
fresh project yields ten ordered rows.

### F002 — Team UI: phases
**Assertions:** AS-008, AS-013
**Files:** `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/phases/*`, `components/project/*`, `components/task/task-detail-sheet.tsx`, `lib/actions/phases.ts`

- Settings page: list, create, rename, reorder (reuse the
  `saved_views` position pattern), set state and dates, toggle client
  visibility, plus one "Add the standard ten phases" action calling
  `seed_default_phases`.
- Phase select in the task detail sheet and in `new-task-dialog.tsx`,
  defaulting to the project's first `active` phase.
- Server actions with Zod validation at the boundary.

**Done when:** a PM can build a phase list and put a task in a phase;
reload preserves both.

### F003 — Portal shell rebuild
**Assertions:** AS-001, AS-004, AS-005, AS-006
**Files:** `app/(portal)/portal/[workspaceSlug]/layout.tsx`, `components/portal/portal-sidebar.tsx`, new route folders

- Replace the top-nav shell with the prototype's sidebar shell:
  brand, project card, eight nav items, footer with the signed-in client
  and the theme toggle. Mobile: the sidebar collapses to a horizontal
  scroller.
- Topbar: breadcrumb eyebrow, view title, launch date chip, launch
  confidence chip.
- Create the eight routes; unimplemented ones render `EmptyState` with
  "Coming in this project" copy rather than 404.
- Badge counts come from one server query, passed down as props.

**Done when:** all eight routes resolve, the active item is marked with
`aria-current`, and a team member is still redirected out.

### F004 — Status vocabulary + design tokens
**Assertions:** AS-015, AS-016
**Files:** `app/globals.css`, `components/portal/status-label.ts`, `components/portal/status-pill.tsx`, statuses settings UI

- Add the four `--status-*` token pairs (values in Design constraints).
- One `StatusPill` component used by every portal view and by the
  team-side board where a client-facing status is shown.
- `project_statuses.client_description` editable in the existing
  statuses settings screen; the pill's tooltip reads it.
- Map each project status to one of the four buckets via its existing
  `category` plus an explicit `client_bucket` column if category is
  insufficient — decide inside the feature, do not add a parallel status
  concept.

**Done when:** the pill renders in both themes from tokens only, and the
tooltip text comes from the database.

### F005 — Portal: Pages view
**Assertions:** AS-014, AS-016, AS-017, AS-018
**Files:** `app/(portal)/portal/[workspaceSlug]/pages/*`, `components/portal/pages-table.tsx`, `components/portal/status-distribution.tsx`, `lib/queries/portal.ts`

- Distribution bar with the four buckets, each with its count in text.
- Table: page name + slug, status pill, who has it (avatar + name +
  role), updated. Ordered by `page_order`, then name.
- Client-side status filter.
- "How a page travels" — the seven steps, with the client's own step
  highlighted; copy from the prototype.
- Team side: `page_slug` / `page_order` editable in the task detail
  sheet for tasks of type `page`.

**Done when:** the view renders real tasks and hides non-client-visible
ones; filtering needs no reload.

### F006 — Portal: Overview view
**Assertions:** AS-002, AS-003, AS-010, AS-031
**Files:** `app/(portal)/portal/[workspaceSlug]/page.tsx`, `components/portal/phase-timeline.tsx`, `components/portal/overview-tiles.tsx`

- Four tiles: waiting on you, pages ready, hours used (placeholder
  until M4 — render "—" rather than a fake number), days to launch.
- Phase timeline as inline SVG: one row per phase, week columns, a
  today rule, bars coloured by state from the status tokens, hover
  tooltip. Must render several active phases at once.
- Risk banner when a blocking deliverable is overdue (wired in M3;
  until then the component exists and renders nothing).
- Reuse the existing "since your last visit" summary
  (`getPortalActivitySummary`) and the live-now widget from
  `active_timers`, showing only client-visible task names.

**Done when:** the overview is the prototype's overview against real
rows, with no placeholder that pretends to be data.

---

## M2 — Approvals

### F007 — Migration: approvals
**Assertions:** AS-019, AS-020, AS-022, AS-023, AS-024
**Files:** new migration

`approval_requests` and `project_decision_owners` per
`docs/client-portal-sixstar-plan.md` P6, plus
`decide_approval_atomic(request_id, decision, note)`:
verifies the caller is the named decision owner, writes the decision,
clears `tasks.pending_client_approval`, writes `audit_log`, creates the
team notification row — one transaction. Decisions are immutable: an
UPDATE that would change a settled row is rejected by policy.

### F008 — Team UI: raise an approval
**Assertions:** AS-019, AS-020
**Files:** `components/task/task-detail-sheet.tsx`, `components/docs/*`, `components/approvals/*`, `lib/actions/approvals.ts`

"Request client approval" from a task, from a document, and standalone
with an artifact URL. Dialog captures subject, decision type, due date,
message. Rejects non-client-visible subjects with an explicit message.

### F009 — Portal: Approvals view
**Assertions:** AS-021, AS-022, AS-023, AS-026
**Files:** `app/(portal)/portal/[workspaceSlug]/approvals/*`, `components/portal/approval-card.tsx`

Open cards (approve / request changes / open artifact), decision history
table, and the "who approves what" grid from `project_decision_owners`.
Reuses and replaces the existing `approval-actions.tsx` path.

### F010 — Team UI: approvals queue
**Assertions:** AS-027
**Files:** `app/(workspace)/w/[workspaceSlug]/approvals/*`

Cross-project queue sorted by wait time, showing what each request
blocks, with remind / withdraw actions. This is the escalation
mechanism that replaces the dropped email work.

### F011 — Request changes creates work
**Assertions:** AS-025
**Files:** RPC extension, `lib/actions/approvals.ts`

A `changes_requested` decision requires a comment and creates a task
carrying it, assigned to the requester, linked back to the approval.

---

## M3 — Your list, scope, decisions

### F012 — Migration: deliverables, scope, decisions, assumptions
**Assertions:** AS-028, AS-043, AS-044, AS-045, AS-046
### F013 — Team UI: client obligations
**Assertions:** AS-028, AS-030, AS-032
### F014 — Portal: Your list view
**Assertions:** AS-029, AS-030, AS-031
### F015 — Team UI + portal: scope, decisions, assumptions
**Assertions:** AS-043 – AS-046
### F016 — Change requests: triage, quote, gate
**Assertions:** AS-047, AS-048 — extends `client_requests` and hardens
`accept_client_request_atomic`.

---

## M4 — Hours and results

### F017 — Migration: budget, work category, client-safe RPC
**Assertions:** AS-033, AS-035, AS-036, AS-037
### F018 — Team UI: budget and work category
**Assertions:** AS-033, AS-038
### F019 — Portal: Hours view (burn-down)
**Assertions:** AS-034, AS-038
### F020 — Migration + team UI: metrics and improvements
**Assertions:** AS-039, AS-040, AS-041
### F021 — Portal: Results view
**Assertions:** AS-041, AS-042

---

## M5 — Site, guides, trust

### F022 — Migration + team UI: links, accounts, doc visibility
**Assertions:** AS-049, AS-050, AS-051
### F023 — Portal: Your site view
**Assertions:** AS-049, AS-050, AS-051
### F024 — Client preview mode
**Assertions:** AS-052, AS-053
### F025 — Leak sweep
**Assertions:** AS-054, AS-055 — three tests per new table plus one
integration walk of every portal route as a real client session.

---

## Notes

- M3–M5 features are specified at plan resolution here and expanded into
  full `features/F0NN-*.md` specs at the start of their milestone, so
  each spec is written with the previous milestone's real code in hand.
- Migrations are applied with `npm run db:apply` against the linked
  project. The Supabase MCP is not authorised in this session; the CLI
  is, and it is the path workers use.
