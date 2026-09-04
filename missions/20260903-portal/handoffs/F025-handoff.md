# Handoff: F025 — The leak sweep

## Status
COMPLETE

## Assertions covered
AS-054: PASS — `tests/integration/f025-portal-table-triple-sweep.test.ts`, 11/11 passing against the live linked project.
AS-055: PASS — `tests/integration/f025-portal-route-walk.test.ts`, 2/2 passing against the live linked project.

## Files changed
tests/integration/f025-portal-table-triple-sweep.test.ts (new)
tests/integration/f025-portal-route-walk.test.ts (new)

## Commands run
`npx vitest run tests/integration/f025-portal-table-triple-sweep.test.ts tests/integration/f025-portal-route-walk.test.ts` (0) — 13 tests passed, ~11.6s wall time (well under the 2-minute budget; the two files can also run independently if a milestone gate wants to split them).
`npx tsc --noEmit -p .` (0)
`npx eslint tests/integration/f025-portal-table-triple-sweep.test.ts tests/integration/f025-portal-route-walk.test.ts` (0)
Did NOT run the full vitest suite, per instructions.

## Decisions made

- **Table list is catalog-derived, not the spec's literal 13 names.** Queried
  `information_schema.columns` on the live linked project (`SUPABASE_PROJECT_REF`
  / `SUPABASE_ACCESS_TOKEN` via the Management API `database/query` endpoint,
  same pattern as `f016i-anon-execute-catalog.test.ts` and
  `f016l-public-table-rls-catalog.test.ts`) for every `public` table carrying a
  `client_visible boolean` column. That query returns 9 tables, not the spec's
  13: `docs, project_accounts, project_assumptions, project_decisions,
  project_improvements, project_links, project_metrics, project_phases, tasks`.
  `approval_requests`, `project_decision_owners`, `client_deliverables`,
  `project_scope_items`, `project_budgets`, and `metric_snapshots` genuinely
  have **no** `client_visible` column of their own — verified by reading each
  table's own `create table` DDL in `supabase/migrations/`, not assumed. Each
  of those six derives client visibility a different way (join to a parent
  row's `client_visible`, e.g. `metric_snapshots` via `project_metrics`; or a
  structural fact instead, e.g. `project_scope_items` — "every scope item is,
  by definition, a client-facing artefact" per that table's own migration
  comment; or team-only, e.g. `project_budgets`). The suite's first test
  (`TABLE_FIXTURES covers exactly the tables...`) asserts the catalog list and
  the fixture map's keys are identical **in both directions**, so this is not
  a silent narrowing — a future table that adds a literal `client_visible`
  column and has no fixture entry fails the suite immediately.
- **Per-table fixture builders are necessarily table-specific code** (columns,
  required-field constraints, enum values differ per table) but the SET of
  tables iterated is 100% catalog-derived, satisfying "derive, do not
  enumerate" for the part of the mechanism that actually decides coverage.
- **RPC leg skipped for `docs` and `tasks`.** Grepped
  `lib/queries/*.ts` for `from("docs")`/`from('docs')`: only
  `lib/queries/docs.ts` (team-side) and `lib/queries/approvals.ts` (artifact
  lookup) touch `docs` — no dedicated client-facing "list every doc" query
  function exists yet, so there is nothing to call for that leg; documented
  inline in the test (`rpc: null`) rather than fabricated. `tasks`' RPC layer
  is already covered thoroughly by `tests/integration/f005-portal-pages.test.ts`
  and `f003-portal-shell.test.ts` (`getPortalPages`/`getPortalOverview`); this
  suite still runs its direct-select and count legs for completeness of the
  catalog-derived sweep.
- **Route walk (AS-055) calls query functions, not live HTTP.** Confirmed by
  reading `f003-portal-shell.test.ts` and `f005-portal-pages.test.ts`: a
  Server Component page cannot render outside a live Next.js request/cookie
  context, so every existing portal test in this mission calls the underlying
  `lib/queries/*` function through the same `vi.mock("@/lib/supabase/server")`
  seam instead of hitting a route over HTTP — no dev server is started or
  stopped anywhere in this test suite. F025's route walk follows that same,
  already-established convention: it walks the filesystem for the *route
  list* (`fs.readdirSync` under `app/(portal)` for every `page.tsx`, real
  derivation — a route added next year is picked up automatically), then
  statically parses each route file's own `import { ... } from
  "@/lib/queries/..."` lines to derive which functions to call (also
  filesystem-derived, not a hand-typed route→function map), then reads each
  target function's own exported signature from its module source to decide
  whether to call it with `projectId` or `workspaceId` (again derived, not a
  hand-typed map) — multi-argument or zero-argument functions are recorded as
  skipped rather than silently included or excluded.
- **Marker fields chosen from real schema, verified by grep, not guessed:**
  `comments.text` (not `.body` — the real column name, confirmed against
  `20260818040214_create_comments.sql`) with `internal = true`;
  `time_entries.note`; `tasks.title` with `client_visible = false`;
  `client_requests.quoted_amount` with `scope_verdict = 'change_request'`,
  `client_decision = 'pending'`, and no `approval_request_id` (an "unsent"
  quote — the team has priced it but never carried it through the approval
  RPC that would formally deliver it to the client); `audit_log.metadata`
  jsonb; and a `sk_live_…`-shaped string planted in `tasks.description` (not
  `project_accounts.service`/`.note`, which carry a `looks_like_credential`
  CHECK constraint that would reject it — confirmed live by grep before
  choosing the field).

## Out-of-scope work needed

- **Finding, not patched:** `client_requests.quoted_amount` has no read-side
  gate distinguishing a quote the team has priced internally from one that has
  actually been sent/approved through `accept_client_request_atomic`. The
  route-walk fixture plants a `scope_verdict = 'change_request'` row with
  `quoted_amount` set, `client_decision = 'pending'`, and no
  `approval_request_id` — i.e. genuinely "unsent" by any definition tied to
  the approval flow — and it does NOT leak through `getProjectChangeRequests`
  in this suite's fixture, because RLS scopes `client_requests` to rows on
  projects the client is a member of, and this fixture's client IS a member
  of the project the row belongs to (by design, to prove the payload-scanning
  mechanism against a realistic same-project quote). Whether a quote a team
  member is still privately drafting (e.g. before deciding whether to even
  send it) should be excluded from the client's own read until some explicit
  "sent" marker is set is a genuine open design question this feature did not
  invent an answer for — noted here as a finding for a follow-up feature
  rather than adding a new column/flag unasked-for.
- No dedicated client-facing "list every doc" query function exists for the
  `docs` table's own client_visible rows (see Decisions above) — if/when the
  portal ships a Files/Guides view that lists docs directly (distinct from
  the existing task-attachment-based `getPortalFiles`), it needs its own
  RPC-leg test added to `TABLE_FIXTURES.docs.rpc` in this suite.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "every RPC that touches the table" (AS-054)
as "every app query function the portal's own routes call for that table",
derived by grepping `lib/queries/*.ts` for `from("<table>")`/`from('<table>')`
rather than Postgres `CREATE FUNCTION` RPCs specifically — none of these 9
tables are read through a Postgres RPC from the client side at all (they are
all plain RLS-gated `select`s via PostgREST/the Supabase JS client), so "RPC"
in the spec's own sense means "the app's data-access layer," matching how
`lib/queries/project-records.ts`'s own header comment describes itself
("Read-side for F012's ... tables").
AUTONOMOUS_DECISION: Ran the mandatory failure test (Definition of Done) on
`project_phases` for the table sweep (AS-054) and on a page-typed task for
the route walk (AS-055) — both chosen because their own RPC leg
(`getProjectPhases` / `getPortalPages`) is a real, already-shipped portal
query function, so the failure test proves the detection mechanism against
production code, not a test-only stub.

## Notes for the next worker

- Both new test files skip themselves (`describe.skipIf(!haveCreds)`) exactly
  like every other integration test in this mission when Supabase REST/
  Management API credentials are absent from `.env`; they throw in CI if
  credentials are missing, matching the established convention.
- The catalog-derivation query
  (`information_schema.columns` filtered to `column_name = 'client_visible'`)
  was run live via the Management API to confirm the exact 9-table list
  before writing `TABLE_FIXTURES` — it is not a paraphrase of the spec's own
  13-table list, and the two differ for the documented reasons above.
- No MCP tools were used (the plan's own Notes section states "The Supabase
  MCP is not authorised in this session; the CLI is, and it is the path
  workers use" — this feature only reads via the Management API's raw SQL
  endpoint and the Supabase JS client, both already the established pattern
  for this mission's catalog-derived tests).
