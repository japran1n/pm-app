# Handoff: W8 — Observability (logger, console.error migration, notification batching)

## Status
COMPLETE

## Assertions covered
No validation-contract assertion IDs were assigned to this worker's brief (infra/observability task, not user-facing behaviour). N/A.

## Files changed
lib/observability/logger.ts (new)
78 files total changed — logger import + console.error → logger.error migration across:
- app/(workspace)/w/[workspaceSlug]/**/*.tsx (12 files)
- app/api/extension/context/route.ts
- lib/actions/*.ts (44 files)
- lib/activity/*.ts
- lib/attachments/*.ts
- lib/notifications/*.ts
- lib/queries/*.ts (16 files)
- lib/recurrence/generate-next-occurrence.ts
- lib/seed/sample-project.ts
- lib/tasks/create.ts
- lib/validation/workspaces.ts

Full list is in the commit `ea76fe7`.

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors, 6 pre-existing warnings unrelated to this change)
`npx vitest run tests/unit` (0 — 179 files / 1392 tests passed, including the F304 `create-notification-error-observability.test.ts` regression test which spies on `console.error`)
`git commit` (0)

## Decisions made
- **Logger design**: `lib/observability/logger.ts` exports a plain object (`logger.debug/info/warn/error`), zero dependencies, <40 lines. In production (`NODE_ENV === 'production'`) it writes one JSON line per call to `process.stdout` with `level`, `message`, `timestamp`, and spread `context` fields — this matches common log-aggregator ingestion (Vercel/Datadog parse JSON stdout lines directly). In development it prefixes the message string itself with `[level] ` and passes it plus the context object as two args to the matching `console.*` fn, so terminal output stays human-readable and multi-line objects still pretty-print via Node's console formatting.
  - Important fix: my first draft passed `(prefix, message, context)` as three separate console args. This broke an existing unit test (`create-notification-error-observability.test.ts`) that asserts `errorSpy.mock.calls[0][0]` (the first arg) contains the caller's context string — because with `NODE_ENV=test` the logger takes the dev branch. I could not modify the test file per the hard rules, so I changed the dev-mode format to bake the prefix into the message string itself (`[error] ${message}`) as the sole first arg, keeping context as the second arg. This is also arguably the better format for console pretty-printing anyway.
- **console.error migration**: wrote a small local Node script (not committed — lived in scratchpad) that: (1) finds every `console.error(...)` call via balanced-paren parsing (safe across multi-line calls), (2) strips a trailing `:` from the message string, (3) folds remaining args into a context object — a single object-literal arg is passed through as-is, a single non-object arg is wrapped as `{ error: <arg> }`, and multiple extra args are folded into a context object. For the ~10 call sites where the original call was `console.error("... for", someId, someError)` (id first, then the actual error), the script's naive folding produced `{ error: id, extra1: actualError }` — I hand-fixed those 10 sites (lib/seed/sample-project.ts, lib/queries/people.ts, lib/actions/templates.ts, lib/actions/invites.ts) to use semantically-named fields (e.g. `{ taskId: task.id, error: updateError }`) instead of the generic `extra1` key.
  - The script's import-insertion pass had a bug on files whose first import statement spans multiple lines (`import {\n  a,\n  b,\n} from "...";`) — it inserted the new `import { logger }` line inside the multi-line block, producing syntax errors. Caught this via `tsc --noEmit`, wrote a second pass that detects and repairs the 16 affected files by moving the logger import to right after the import block's closing `} from "...";` line.
  - Left untouched: comments that merely *mention* `console.error` (e.g. in `lib/activity/audit.ts`, `lib/actions/attachments.ts`, two workspace settings pages) and the logger's own internal use of `console.error`/`console.warn`/`console.log` as its dev-mode transport.
- **Notification fan-out batching**: read `lib/notifications/create-notification.ts` first, as instructed. `createNotification` is **not** a plain INSERT wrapper — it calls the `create_notification` Postgres RPC, a `SECURITY DEFINER` function (see `supabase/migrations/20260823020000_create_notifications.sql` plus three follow-up hardening migrations: `20260823030000_fix_create_notification_spoofing.sql`, `20260823100000_fix_create_notification_system_bypass.sql`, `20260823110000_create_notification_task_workspace_check.sql`). Those migrations exist specifically because this RPC does real work beyond an INSERT: it validates the recipient is an active workspace member, validates the `kind` against a CHECK constraint, checks the task/workspace relationship, and (per notification-preferences code) is expected to respect per-user notification preferences. Per the brief's own instruction ("If it does more (triggers, RLS, etc.), note that and skip"), I did **not** convert any of the `for (... of recipients)` fan-out loops in `lib/actions/tasks.ts`, `lib/actions/comments.ts`, `lib/actions/chat-messages.ts`, or `lib/notifications/mentions.ts` to a raw batched `insert()` — doing so would silently bypass the membership/kind/task-workspace checks that three separate prior hardening migrations were written specifically to enforce, reintroducing the spoofing/system-bypass bug classes those migrations fixed.

## Out-of-scope work needed
- If serial fan-out latency (e.g. a 40-watcher task making 40 sequential RPC round-trips) needs to be fixed, the correct fix is a **new** batched RPC variant (e.g. `create_notifications_batch(p_recipients jsonb[], ...)`) that performs the same SECURITY DEFINER validation per-row inside a single Postgres function/transaction, callable once with an array of recipients instead of N client round-trips. That requires a new migration + updating `createNotification`'s call sites to use a new `createNotifications(supabase, paramsArray, context)` helper. This is a real perf win but is schema/RPC work outside a "zero new dependencies, no public signature changes" observability worker's scope — flagging as a follow-up feature for whichever milestone owns notification-fanout performance.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose to bake the `[level]` prefix into the message string itself in dev-mode console output (rather than passing it as a separate leading arg) so that an existing unit test asserting on `console.error`'s first call argument continues to pass without modifying the test file, and because it also produces cleaner terminal output.
AUTONOMOUS_DECISION: For call sites where remaining args after the message were an identifier followed by an error object (id-then-error), used semantically named context keys (e.g. `taskId`, `userId`, `inviteId`) instead of the generic `error`/`extraN` fallback the transform script produces, for consistency with the JSON-structured-log intent.

## Notes for the next worker
- The batch-conversion script (paren-balanced console.error → logger.error rewriter) is not committed; it lived in the scratchpad dir for this session only. If another sweep is needed later (e.g. after Sentry DSN is wired), it can be reconstructed the same way — find calls via balanced-paren scan rather than regex, since many call sites span multiple lines with nested objects.
- Sentry DSN integration is deferred per the mission's connection plan (no credential set yet). `logger.ts`'s `emit()` function is the single choke point where a future `Sentry.captureException`/`captureMessage` call can be added for `warn`/`error` levels without touching any of the ~300 call sites that were just migrated to `logger.error(...)`.
- No MCP tools were needed for this task (pure application-code refactor, no live external service state involved).
