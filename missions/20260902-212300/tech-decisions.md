# Tech Decisions — Mission 20260902-212300

_All choices verified against the repository and the linked Supabase project
on 2026-09-02, not from memory (rule P-2). This is a brownfield mission: the
correct decision in almost every case is "reuse what is already there", and
each such decision names the artefact it reuses._

## No new dependencies

Verified `package.json` at commit `2db1bad`. Everything this mission needs is
already installed:

| Need | Existing package | Version in repo |
|---|---|---|
| Optimistic UI | `react` (`useOptimistic`) | 19.2.8 |
| Realtime | `@supabase/supabase-js` | ^2.112.3 |
| Drag & drop | `@dnd-kit/core`, `@dnd-kit/sortable` | ^6.3.1, ^10.0.0 |
| Toasts | `sonner` | ^2.0.8 |
| Unit/component tests | `vitest`, `@testing-library/react` | ^4.1.10, ^16.3.2 |
| E2E | `@playwright/test` | ^1.62.1 |
| Framework | `next` | 16.3.1 |

**Decision:** install nothing. Any worker that reaches for a new dependency is
out of scope and must report BLOCKED instead.

## Supabase CLI

Verified locally: `npx supabase --version` → **2.116.0**.

`supabase migration list --help` (run 2026-09-02) confirms the flags this
mission depends on:
- `--linked` — lists migrations applied to the linked project.
- Global `--output-format json` — machine-readable output.

**Decision:** the drift guard shells `npx supabase migration list --linked
--output-format json` and parses the `migrations` array, treating any entry
with a falsy `remote` as drift. This is preferred over scraping the text table,
whose column layout is not a stable contract.

## Migration application path

This project is **remote-only** — there is no local Supabase stack and no
database password in `.env`. `scripts/apply-migration.mjs` (already in the
repo, wired to `npm run db:apply`) applies a single migration file through the
Management API using `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF`, both of
which are present in `.env`.

**Decision:** any migration this mission adds is applied with
`npm run db:apply -- <file>`, never `supabase db push`.

## Live-state findings that shaped the plan

Two things were checked against the linked project (`qcipqonnqajmazdbysow`)
rather than assumed, and both changed the plan:

1. **There is currently no migration drift.** `supabase migration list --linked`
   returns a remote counterpart for all 145 local migrations, including
   `20260905080000`–`20260905110000`, which the previous mission's UX validator
   reported as pending. That note is stale. The drift guard is therefore
   *preventative*, not remedial — no migrations need applying, and the guard's
   first run is expected to pass.

2. **`client_requests` is NOT in the `supabase_realtime` publication.** Queried
   via the Management API:
   `select tablename from pg_publication_tables where pubname='supabase_realtime'`
   returns exactly: `channel_members, channels, comment_reactions, comments,
   message_reactions, messages, notifications, project_statuses,
   task_assignees, tasks`. So portal request realtime needs a publication
   migration first, and it is exactly the failure mode that broke M2 of the
   previous mission.

## Corrections to the pre-mission assessment

Two claims made in the status review before this mission were checked against
the code and are wrong. Recording them so no worker acts on them:

- **"Kanban has no optimistic update."** False. `components/board/board.tsx`
  already applies the drop to local state before the Server Action resolves
  (`setTasks(next)` at the top of the persist block) and has a `rollback()`
  helper with a `rolledBack` double-fire guard. The board's optimistic UI is
  complete. The *real* remaining gap is narrower and is what this mission
  targets: `pendingOptimisticCreatesRef` guards optimistic **creates** against
  realtime echoes, but there is no equivalent guard for optimistic **moves**,
  so an inbound `tasks` UPDATE can clobber a drag still in flight.
- **"The four tail migrations are pending."** False, as above.

## Portal architecture decision

The portal pages are async RSCs (`app/(portal)/portal/[workspaceSlug]/*`) doing
their own Supabase queries. Realtime needs a client component.

**Decision:** keep each page an RSC and extract only the live regions into
client components seeded by server props — the pattern
`components/task/task-list-table.tsx` already uses. Do not convert a page to a
client component; that would lose the RLS-scoped server query that defines what
the client is allowed to see.

## Reconciliation

`lib/tasks/reconcile-list-realtime-task.ts` and
`lib/tasks/reconcile-my-tasks-realtime-task.ts` already encode the
insert/update/delete/leaves-the-set logic this mission needs.

**Decision:** add a portal reconciler in the same shape and directory rather
than importing one of the existing two verbatim — the portal's membership
predicate is `client_visible && !deleted_at` plus a per-surface predicate,
which neither existing reconciler expresses.

## Channel isolation

`lib/realtime/shared-topic-channel.ts` provides ref-counted channel acquisition
keyed by topic, and already exists to solve StrictMode double-subscribe.

**Decision:** split `use-my-tasks-realtime.ts` into two `acquireSharedTopicChannel`
calls with topics `tasks:my-tasks:<userId>:assignees` and
`tasks:my-tasks:<userId>:tasks`. The tracked-id `Set` stays a single shared
object passed to both, so the cross-channel invariant (AS-011) holds.

## Test strategy

**Decision:** every new test is a unit or component test with a mocked Supabase
client, following the existing `*.test.tsx` colocation convention. No new test
touches `tests/integration/**` (AS-034) — that suite's 38 live-Supabase
failures are pre-existing and explicitly out of scope. The single new Playwright
spec (AS-029/AS-030) lives in `tests/e2e/` and is not part of the unit gate.
