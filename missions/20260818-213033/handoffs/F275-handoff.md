# Handoff: F275 — due-date display uses the user's timezone

## Status
COMPLETE

## Assertions covered
AS-207: PASS — due-date and overdue calculations use the user's timezone, not the server's.
  Reproduction from M10-scrutiny.md's AS-207 section (`due_date "2026-08-20"` rendering
  "Aug 19, 2026" under `TZ=America/New_York`) no longer reproduces: the same function now
  returns "Aug 20, 2026" for every zone from -12 to +14 (verified in
  `tests/unit/user-timezone.test.ts`). Cross-layer agreement between `get_overdue_count`
  (SQL) and `isOverdueInTimeZone` (client) is now covered by an executable test for a zone
  on each side of UTC (`tests/integration/overdue-count-rpc.test.ts`).

## Files changed
lib/time/user-timezone.ts
components/task/task-card.tsx
components/task/task-list-table.tsx
components/task/task-detail-sheet.tsx
components/board/board.tsx
components/board/board-column.tsx
components/board/sortable-task-card.tsx
components/dashboard/dashboard-task-table.tsx
lib/queries/dashboard.ts
supabase/migrations/20260818225500_profiles_timezone_check.sql
tests/unit/user-timezone.test.ts
tests/integration/overdue-count-rpc.test.ts
tests/integration/dashboard-workspace-switch-refresh.test.ts
tests/unit/board-column.test.ts
tests/unit/board-column-counts.test.ts
tests/unit/list-view-empty-state.test.ts
tests/unit/list-table-status-priority-colors.test.ts
tests/unit/keyboard-a11y-pass.test.ts
tests/unit/board-optimistic-rollback-toast.test.ts
tests/unit/board-task-detail-sheet-wiring.test.ts
tests/unit/board-dnd-setup.test.ts
tests/unit/board-move-status-wiring.test.ts

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, same 1 pre-existing warning in lib/queries/search.ts as the M10 baseline — nothing new)
`npx vitest run tests/integration/overdue-count-rpc.test.ts --testTimeout=30000` (0 — 8/8 passed, includes all 3 new AS-207 cross-layer tests)
`npx vitest run --testTimeout=30000` (0 — 104/104 files, 582/582 tests passed)
`npm run test` (1 — flaked on unrelated `Request rate limit reached` auth sign-in errors in `workspace-switcher-scope.test.ts` / `workspace-members-list.test.ts` at the default 5s timeout against the remote Supabase project; re-ran clean at `--testTimeout=30000` above, matching the exact non-determinism the assignment warned about — not a regression from this change)
`supabase db push` (0 — applied `20260818225500_profiles_timezone_check.sql`)
`supabase db query --file ... --linked` (0 — verified `is_valid_timezone('UTC')`/`('America/New_York')` = true, `('Not/A_Real_Zone')` = false, and `profiles_timezone_valid` constraint present via `pg_constraint`)

## Decisions made
- **`formatDueDate`'s actual fix is not "just pass `timezone` to `Intl.DateTimeFormat`."**
  `due_date` is a plain calendar date with no time component. The buggy code ran
  `new Date(dueDate)` (parses a date-only string as UTC midnight) through
  `Intl.DateTimeFormat` with no `timeZone`, so the ambient runtime zone rolled the date
  back a day west of UTC. Naively adding `timeZone: <viewer's zone>` on top of that same
  `new Date(dueDate)` instant does **not** fix it — for America/New_York (UTC-4 in August)
  it produces the identical wrong "Aug 19". Verified by hand: `new Intl.DateTimeFormat(
  "en-US", {timeZone:"America/New_York", month:"short", day:"numeric", year:"numeric"})
  .format(new Date("2026-08-20"))` → "Aug 19, 2026". The actual fix anchors on
  `startOfDayInTimeZone(dueDate, timeZone)` (the UTC instant `timeZone`'s own local
  midnight begins for that date) and formats that SAME instant back through the SAME
  `timeZone` — round-tripping through one consistent zone guarantees the displayed y/m/d
  always equals the stored `dueDate`, for every real IANA zone, not just UTC. Confirmed
  this holds for the full -12..+14 offset range in `tests/unit/user-timezone.test.ts`'s
  `test_AS_207_formats_the_due_date_identically_regardless_of_which_zone_the_viewer_is_in`.
- **`formatDueDate` still takes `timeZone` as an explicit, required argument** (not
  hardcoded to "UTC" internally) per the assignment and to match every other function in
  `lib/time/user-timezone.ts`'s "never read from ambient, always an explicit argument"
  convention — even though, for a pure date-only value, the round-trip technique makes the
  *displayed* result the same for every zone by construction. This keeps the module
  internally consistent and leaves room for a future date type that does carry a time
  component.
- **`formatDueDate` takes an `options: Intl.DateTimeFormatOptions` parameter** (defaulting
  to `{month:"short", day:"numeric", year:"numeric"}`) so the one shared helper can still
  produce task-card.tsx's shorter no-year form ("Aug 20") and task-list-table.tsx's
  full form ("Aug 20, 2026") — this was the only behavioral difference between the two
  original local copies, preserved deliberately rather than unified.
- **Made `getOverdueCount` (lib/queries/dashboard.ts)'s `timezone` parameter required too**,
  not just the React props explicitly named in the assignment. M10 scrutiny's AS-207
  write-up listed this exact site (`lib/queries/dashboard.ts:107`) alongside the component
  props as one of the "optional at every React boundary with a silent UTC default" sites —
  leaving it optional would have left one silent-default hole in the same call chain the
  rest of this fix closes. The RPC's own SQL-side `p_timezone default 'UTC'` is untouched,
  so a raw `supabase.rpc()` call bypassing this wrapper still works.
- **CHECK constraint implementation**: Postgres CHECK constraints cannot contain
  subqueries, so a direct membership test against `pg_timezone_names` wasn't usable.
  Instead defined `public.is_valid_timezone(tz text)` — a `plpgsql` function that attempts
  `timestamp '2000-01-01 00:00:00' at time zone tz` (a fixed anchor, not `now()`, so the
  function is safe to mark `immutable`) and catches `invalid_parameter_value` (22023,
  exactly the error code M10 scrutiny's write-up names) to return `false` instead of
  aborting. This accepts precisely the same values Postgres's own `AT TIME ZONE` accepts,
  including the bare `"UTC"` alias `profiles.timezone`'s own default and every existing row
  already use — confirmed via `supabase db query` that the migration applied cleanly
  against all live rows with no data cleanup needed.
- **Did not touch `lib/validation/profile.ts`'s `isValidTimeZone`** (the app-level Zod
  check). The scrutiny report's FU-3 paragraph mentions tightening it to
  `Intl.supportedValuesOf("timeZone")` plus an explicit `"UTC"` alias, but that file's own
  existing comment documents in detail why it deliberately does NOT do that today (CLDR's
  `supportedValuesOf` list excludes the bare `"UTC"` string, which is `profiles.timezone`'s
  own DB default — a naive switch would reject every user's own unchanged default the
  first time they saved the settings form). This wasn't in my assigned scope (helper +
  required props + CHECK constraint + the two named test categories) and changing it
  without re-deriving that same alias-handling logic risked reintroducing the exact bug
  that comment warns about. Left as-is; noted below under Out-of-scope.

## Out-of-scope work needed
- **FU-3's `isValidTimeZone` tightening** (lib/validation/profile.ts): if a future worker
  does this, they must preserve the `"UTC"` alias carve-out `lib/validation/profile.ts`'s
  existing comment documents — a plain `Intl.supportedValuesOf("timeZone").includes(value)`
  switch would reject the DB default itself.
- **FU-4** (profiles RLS gaps — AS-210/AS-208 hardening), **FU-5** (DOM test environment,
  AS-214), **FU-6** (CI credentials, theme first-paint tests) are separate scrutiny
  follow-ups, unrelated to AS-207, not touched here.
- The scrutiny report's "minor" adjacent-ambient-time findings
  (`components/task/time-tracking.tsx`'s `todayDateString()`, `time/page.tsx`'s
  `defaultRange()`, timer RPCs' `current_date` writes) are outside AS-207's scope (a
  different assertion class — none of them are the due-date *display* bug this feature
  fixes) and were left untouched, per the clarification's "scope is limited to the FAIL
  items named... for the assertions this follow-up carries."

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Made `getOverdueCount`'s `timezone` parameter required (see Decisions
made above) even though the assignment's literal wording named the "board/list/dashboard
component chain" — treated as in-scope because it's the same silent-UTC-default antipattern
in the same call chain, explicitly named by the scrutiny report under AS-207, and leaving it
optional would have left the fix incomplete by its own stated goal ("so a future page that
forgets to pass it is a type error rather than a silent UTC render").

AUTONOMOUS_DECISION: Chose the `startOfDayInTimeZone`-round-trip formatting technique over a
literal reading of FU-3's "pass the timezone prop into Intl's timeZone option" because a
literal reading (keeping `new Date(dueDate)` and just adding `timeZone` to
`Intl.DateTimeFormat`) does not actually fix the bug for zones west of UTC — verified by
hand-computation before writing any code (see Decisions made). The chosen approach still
takes `timeZone` as Intl's `timeZone` option (satisfying the letter of FU-3) while actually
producing the assertion's required outcome.

## Notes for the next worker
- `formatDueDate`'s doc comment in `lib/time/user-timezone.ts` explains the round-trip
  technique and explicitly calls out why the naive fix doesn't work — read it before
  touching due-date rendering again.
- Making `timezone` required rippled into 9 test files that render `TaskCard`/
  `TaskListTable`/`Board`/`BoardColumn` via `createElement(...)` without a DOM (this repo's
  established `environment: "node"` + `renderToStaticMarkup` pattern, no jsdom — see
  AS-214's finding in M10-scrutiny.md for why). All were updated to pass `timezone: "UTC"`
  explicitly; `npx tsc --noEmit` is the fastest way to find every such call site if this
  prop chain changes again.
- No MCP tools were available/used for this feature (`mcp-registry.md` marks Supabase MCP
  "Optional" with the CLI as the primary path); all schema work went through
  `supabase migration new` + `supabase db push` + `supabase db query --file ... --linked`
  for verification, per the registry's guidance.
