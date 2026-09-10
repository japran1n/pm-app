# Tech decisions

_Mission: 20260910-182104_
_Verified: 2026-09-10_

**Context.** This mission extends an existing production application. There
is no stack to choose — the stack exists. The version work here was
therefore not "what shall we pick" but "is what we already run still the
current thing, and does this mission need anything new". The answer to the
second question is **no new dependencies**.

## Stack

- Language: TypeScript 5.x <!-- from package.json devDependencies; unchanged by this mission -->
- Framework: Next.js 16.3.1, App Router <!-- installed version, package.json -->
- React 19.2.8 <!-- installed version, package.json -->
- Styling: Tailwind CSS 4 <!-- installed version, package.json -->
- Database: Supabase Postgres, 250 existing migrations <!-- supabase/migrations -->
- Auth: Supabase Auth, already configured <!-- existing app, untouched by this mission -->
- Drag and drop: `@dnd-kit` legacy line <!-- see "Libraries used" for the verification note -->

## Libraries used

- `@dnd-kit/core` `^6.3.1` — board and column dragging. **6.3.1 is the newest published version of this package**, confirmed against the npm registry on 2026-09-10 (`npm view @dnd-kit/core version` → `6.3.1`). Already installed; already used by `components/board/board.tsx`, `components/nav/project-nav-list.tsx`, `components/docs/docs-sidebar.tsx`, `components/task/checklist.tsx` and four more.
- `@dnd-kit/sortable` `^10.0.0` — section and question reordering. **10.0.0 is the newest published version**, confirmed via `npm view @dnd-kit/sortable version` on 2026-09-10. Already installed.
- `@dnd-kit/utilities` `^3.2.2` — transform helpers used by the existing sortable components. Already installed.
- `@base-ui/react` `^1.7.0` — combobox primitive behind the component picker (F026). Already installed and already the app's primitive layer.
- `cmdk` `^1.1.1` — search-in-list behaviour for the component picker, matching the existing palette search. Already installed.
- `zod` `^4.4.3` — server-action input validation, matching `lib/validation/`. Already installed.
- `vitest` `^4.1.10` + `@testing-library/react` `^16.3.2` — unit and component tests. Already installed.
- `@playwright/test` `^1.62.1` — behavioural assertions for the UX validator. Already installed.

**Net new packages required by this mission: none.** No `npm install` runs
during `/mission-connect`.

## Libraries explicitly avoided

- `@dnd-kit/react` (`0.5.0`) — the successor generation of dnd-kit, built on `@dnd-kit/abstract` and `@dnd-kit/dom`. Verified current version `0.5.0` via `npm view @dnd-kit/react version` on 2026-09-10. **Rejected**: it is pre-1.0, and the eight existing drag-and-drop surfaces in this codebase all use the legacy line. Introducing a second, incompatible dnd library for one new board would fragment the codebase and put an unstable major-zero dependency on the mission's critical path. Revisit as a codebase-wide migration, not as a side effect of this mission.
- `react-beautiful-dnd` — unmaintained and already absent from this codebase.
- Any charting or diagramming library — the board is columns of cards, not a graph. Nothing to draw.
- Any AI/LLM SDK — discovery answer 27 puts AI brief generation definitively out of scope.
- Any external sitemap or design-tool API client (Octopus, Figma, Webflow, Drive) — discovery answer 28 puts integration out of scope. `page_links` already stores those URLs as plain references.

## File layout

```
app/(workspace)/w/[workspaceSlug]/projects/[projectId]/
  architecture/          # M2–M5 board route
app/(portal)/p/[projectId]/
  architecture/          # M5 client read-only board
  brief/                 # M7 client questionnaire
components/
  architecture/          # board, column, section card, component panel
  brief/                 # question editor, answer views
lib/
  queries/architecture.ts
  queries/brief.ts
  actions/architecture.ts
  actions/brief.ts
  validation/architecture.ts
  validation/brief.ts
supabase/migrations/     # 5 new migrations (F002, F003, F044, F045, F046, F047)
```

## External services needed

**None.** This mission adds no external service, no credential, and no MCP
server. Everything runs against the Supabase project the application
already uses.

For completeness, the MCP servers already registered in this workspace and
available to workers are: Supabase (schema introspection and SQL),
Playwright (UX validation), plus Figma, Webflow, ClickUp and Google Drive —
the last four are **not used by this mission** and workers must not call
them, per discovery answers 26 and 28.

`/mission-connect` has nothing to do for this mission and can be skipped
after it confirms the Supabase MCP responds.

## How to run the app

```
npm run dev
```

## How to run tests

```
npm run test
```

## How to run linter

```
npm run lint
```

## How to run type-check

```
npx tsc --noEmit
```

## Conventions

**Migrations.** Every migration opens with a header comment naming the
mission and feature, listing the existing objects it relies on, and stating
what was verified immediately before writing — the shape every migration in
`supabase/migrations/` already follows. Read the referenced migrations
first; do not cite one from memory. Every `SECURITY DEFINER` function pins
`set search_path = public, pg_temp`.

**RLS.** Client-facing select policies carry all conjuncts — membership via
`is_project_visible_to`, role via `is_project_client`, and
`is_project_portal_enabled` — never membership alone. `20261014010000`
exists because a policy once checked membership without role.

**Queries.** Read functions live in `lib/queries/`, are batched to avoid
N+1, and come in pairs where a portal view exists: an unfiltered team reader
and a client-filtered sibling that applies the visibility predicate
explicitly on top of RLS. Follow `lib/queries/page-links.ts`.

**Actions.** Mutations live in `lib/actions/`, validate input with a Zod
schema from `lib/validation/`, and return a typed result rather than
throwing across the boundary.

**Design system.** Colours are derived from the six OKLCH knobs in
`app/globals.css`; never hand-write a hex for a semantic token. Both themes
must resolve — a token defined only inside one theme block is a bug. Inter
450/500/600 only. Data is mono: slugs, counts, dates, IDs. Cards carry
`shadow-xs` and nothing else carries a shadow. Hover lifts the border or
fills with `bg-muted/50`.

**Hover highlighting.** The component highlight is CSS-driven —
`data-hover-component` on the board root, `data-component` on each card, one
selector doing the work. It must not pass through React state; a board of
480 cards cannot re-render on pointer move.

**Naming.** Board terminology in code follows the domain: a page is a task
with a slug, a section is its subtask. Do not introduce a parallel `Page` or
`Section` entity — that duplication is the disease this mission treats.

**Tests.** Every migration ships negative RLS tests alongside positive ones.
Behavioural assertions are exercised through Playwright; data assertions
through Vitest.
