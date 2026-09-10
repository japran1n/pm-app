# Plan — 20260910-supabase-ds

Draft features. `/mission-tasks` enriches each one before any worker runs.
Ordering is a real dependency chain: each phase is only verifiable once the
one before it has landed.

Measured baseline: 761 ts/tsx files, 306 components, 34 ui primitives,
67 routes, 587 tests, 1,079 occurrences of retiring type utilities across
255 files.

---

## Phase A — Foundation (blocks everything)

- **F001** Vendor Supabase's token engine into `app/globals.css`
  (semantic + compat), keeping the existing `@theme inline` names so no
  component breaks. → SD-001, SD-004
- **F002** Add both theme blocks (`dark.css`, `light.css`) with their
  published knob values. → SD-002, SD-003
- **F003** Extend `@theme inline` with the brand / warning / destructive /
  surface / border scale mappings ported components need. → SD-001
- **F004** Swap fonts in `app/layout.tsx`: Inter without `opsz`, Source Code
  Pro in, IBM Plex Mono out. → SD-006
- **F005** Replace the Tailwind type scale with Supabase's Inter-tuned
  values and set `--font-weight-normal: 450`. → SD-007, SD-008

## Phase B — Type-scale codemod

- **F006** Codemod `text-micro` → `text-xs` (355 occurrences, 140 files).
- **F007** Codemod `text-mini` → `text-sm` (599 occurrences, 218 files).
- **F008** Codemod `title-1/2/3` → `text-xl/2xl/3xl font-semibold`
  (87 occurrences, 73 files).
- **F009** Replace `text-tag` with the Supabase Badge (26 occurrences).
- **F010** Sweep the stragglers: `text-tiny`, `text-small`, `text-regular`,
  `text-large`, `text-link`. Delete every retired utility from
  `app/globals.css`. → SD-009
- **F011** Purge weights 510/590 and remaining `--gg-*` references.
  → SD-007, SD-004

## Phase C — Primitives, pure-CSS group

- **F012** card, skeleton, separator → SD-013, SD-014
- **F013** table (header, cell, edge padding) → SD-016, SD-019
- **F014** status-badge and badge → Supabase Badge anatomy → SD-015
- **F015** textarea, label, input-group
- **F016** command, calendar
- **F017** icon-button, sonner

## Phase D — Primitives, Base UI group

- **F018** button — full variant set, sizes from `SIZE.height` → SD-018
- **F019** input, checkbox, radio-group, switch, toggle, toggle-group
- **F020** select + the `data-[state=open]` → `aria-expanded` mapping
- **F021** dialog, alert-dialog, sheet
- **F022** popover, hover-card, tooltip, dropdown-menu
- **F023** tabs, breadcrumb, progress, scroll-area, collapsible, avatar

## Phase E — Theme switching (new functionality)

- **F024** Install and wire `next-themes` with
  `attribute={["class","data-theme"]}` and no-flash script. → SD-021, SD-022
- **F025** Theme switch control in the workspace UI. → SD-020
- **F026** Theme switch control in the portal UI. → SD-020
- **F027** Per-viewer persistence; verify no cross-user leakage. → SD-024

## Phase F — Feature surfaces

Three rules applied per area: data is mono, space opens up, hover moves to
the border.

- **F028** Board — columns, cards, swimlanes, quick add
- **F029** List view and task-list-table
- **F030** Task detail — header, fields, activity
- **F031** Task detail — checklist, time tracking, attachments
- **F032** My tasks
- **F033** Dashboard and charts
- **F034** Projects list, project header, project tabs
- **F035** Project panels — budget, measurement, team hours (the three
  densest files in the codebase)
- **F036** Docs list and doc editor chrome
- **F037** Chat — channel list, message list, thread panel
- **F038** Time — my time, global tracker, per-user views
- **F039** Calendar
- **F040** Settings — general, members, task types, status templates
- **F041** Audit log, trash, archive, templates
- **F042** Approvals and client requests
- **F043** Navigation — sidebar, header, breadcrumb, search, command palette
- **F044** Onboarding, empty states, error and loading states
- **F045** Notifications, whats-new, help

## Phase G — Portal unification

- **F046** Retire the `[data-surface="portal"]` palette scope. → SD-025
- **F047** Portal shell, nav and layout onto the shared tokens
- **F048** Portal project views and phase timeline
- **F049** Portal approvals, guides, links, task list
- **F050** Portal charts — burndown, weekly delivery, pipeline
- **F051** Purge every Good Guys 3.0 value. → SD-026

## Phase H — Validation

- **F052** Mono-coverage audit against SD-010 / SD-011
- **F053** Contrast audit, both themes. → SD-005, SD-023
- **F054** Update the two test files asserting retired classes; full suite
  green. → SD-028
- **F055** Route-by-route pass, both themes, 67 routes. → SD-029
- **F056** Behaviour-preservation diff: confirm `resolveClientBucket`
  untouched and no copy/flow change. → SD-027, SD-030
