# Tech decisions — Team Planner

_Mission: 20260920-124226_  _Written: 2026-09-20_

This mission adds **no new dependency** (AS-084). Everything it needs is
already installed. The version-freshness rule still applies, so each
existing choice this mission leans on was re-checked rather than assumed,
and the two candidate additions that were considered and rejected are
recorded below with their reasons.

## Stack

- Language: TypeScript 5.x — already in `devDependencies` as `typescript: ^5`
- Runtime: Node >= 24 — already pinned in `package.json` `engines`
- Framework: Next.js 16.3.5, App Router, Turbopack dev  <!-- installed version read from package.json 2026-09-20; async `searchParams` already used on the Planner route, matching Next 15+ behaviour -->
- UI runtime: React 19.2.8
- Database: Supabase Postgres, access exclusively through RLS-scoped session clients  <!-- policy authoring re-checked against https://supabase.com/docs/guides/database/postgres/row-level-security 2026-09-20: USING governs existing rows, WITH CHECK the proposed row; RLS changes belong in a migration, not the SQL editor -->
- Styling: Tailwind v4 + shadcn/ui on the Supabase design system per CLAUDE.md

## Libraries used

- `@dnd-kit/core ^6.3.1` + `@dnd-kit/sortable ^10.0.0` — row reordering in the stacked layout (F035). Already a dependency and already the drag primitive used by the board, the docs sidebar, the architecture columns, and — importantly — the existing calendar day grid, so the Planner stays on one drag stack.  <!-- current state checked at https://www.npmjs.com/package/@dnd-kit/sortable and https://dndkit.com/changelog/ on 2026-09-20 -->
- `date-fns ^4.4.0` — week/day arithmetic, already used by the calendar helpers.
- `zod ^4.4.3` — the block Server Action schema F018 edits.
- `vitest ^4.1.10`, `@testing-library/react ^16.3.2` — unit and component tests.
- `@playwright/test ^1.62.1` — the three E2E specs in F040.

## Libraries explicitly avoided

- **`@dnd-kit/react` (the dnd-kit rewrite, v0.5.0 as of June 2026).** The rewrite is real and current, but it is still pre-1.0 and this repository has ten existing call sites on the classic `@dnd-kit/core` + `@dnd-kit/sortable` pair. Introducing a second, incompatible drag library for one row-reorder interaction would mean two drag stacks in the same route. Revisit as its own migration, not inside this mission.  <!-- checked https://dndkit.com/changelog/ and https://github.com/clauderic/dnd-kit/releases on 2026-09-20 -->
- **Any virtualisation library (react-window / react-virtuoso).** Round 1 answer 26 chose "no hard limit, the list scrolls", and a workspace here is on the order of tens of members, not thousands. AS-068 asks for scrolling, not virtualisation.
- **Any charting or capacity library.** Answers 17, 19 and 2.14 removed hours and capacity from scope entirely; AS-069 forbids them.
- **`localStorage` wrappers.** Answer 30 put all state in the URL; AS-013 forbids browser storage for this view.

## File layout

```
app/(workspace)/w/[workspaceSlug]/calendar/
  page.tsx                          # layout derivation + fetch (F016, F031)
components/calendar/
  people-switcher.tsx               # new (F026–F030)
  stacked-planner.tsx               # new (F032–F036)
  stacked-person-row.tsx            # new (F033)
  week-view.tsx                     # header gains the switcher (F030)
  week-time-grid.tsx                # ownership-gated affordances (F020–F024)
  calendar-block-popover-form.tsx   # read-only variant, task link removed (F018, F023)
  calendar-filters.tsx              # DELETED (F017)
lib/calendar/
  people-selection.ts               # new, pure (F002, F003, F006)
  planner-layout.ts                 # new, pure (F004)
  stacked-window.ts                 # new, pure (F005)
  resolve-filters.ts                # DELETED (F017)
lib/queries/
  calendar-blocks.ts                # ordered userIds filter (F012, F013)
  calendar.ts                       # getCalendarTasks becomes unused here (F016)
supabase/migrations/
  <ts>_calendar_blocks_workspace_wide_select.sql   # F008
  <ts>_calendar_blocks_drop_task_id.sql            # F009
```

## External services needed

- **Supabase** — the only external service this mission touches. Already connected; the project's own migration tooling (`npm run db:apply`, `npm run migrations:check`) is the apply path. An official Supabase MCP server exists and is the preferred route for live schema and RLS introspection during the run phase; `/mission-connect` confirms whether this workspace's registry already has it before M2 starts.
- No payment, email, AI, search, analytics, or storage service is involved. Nothing new needs credentials.

## How to run the app

```
npm run dev
```

## How to run tests

```
npx vitest run tests/unit
```

## How to run linter

```
npx eslint . --max-warnings=0
```

## How to run type-check

```
npx tsc --noEmit
```

## Conventions

- **Pure logic before rendering.** Parsing, clipping, and ordering live in `lib/calendar/*.ts` as pure functions with their own unit tests (M1), and components consume them. No date or window arithmetic inside a component.
- **`?people=` is order-significant.** Never pass the selection through a `Set` and re-emit it; the id sequence is the row order (AS-009, AS-063, AS-065). Dedupe by keeping the first occurrence.
- **Filter in the query.** Person selection narrows the SQL, never a post-fetch `.filter()` (AS-029), matching the posture `getCalendarTasks` already established for its own filters.
- **RLS is the enforcement boundary.** Read paths use the session client. `createAdminClient()` is not used anywhere in this feature.
- **Ownership is one predicate.** F020 defines it once; F021–F024 consume it. Do not re-derive `block.userId === currentUserId` at each call site.
- **Migrations carry their reasoning.** Both migrations in M2 open with a comment explaining what changed and why, in the style the existing migrations use — and the RLS one states explicitly that it widens access, since a reader skimming it later must not mistake it for a refactor.
- **Deletions are deletions.** Obsolete tests are removed, not skipped or commented out (AS-080), and no unreachable task code is left behind on the route (AS-081).
- **Errors.** Stale or tampered URL values are dropped silently and the view still renders, which is the posture `resolveCalendarFilters` already used before this mission removes it.
