# Validation Contract — Mission 20260902-212300

_Immutable once `APPROVED` exists. New requirements get new IDs; existing
assertions are never edited or deleted._

Every assertion is falsifiable: it names an observable behaviour and the
condition under which it is wrong.

---

## Migration drift & realtime health (M1)

- **AS-001** — `npm run migrations:check` exits 0 when every migration file in
  `supabase/migrations/` has a corresponding applied migration on the linked
  project.
- **AS-002** — `npm run migrations:check` exits non-zero and names the offending
  version(s) when at least one local migration file has no remote counterpart.
- **AS-003** — `npm run migrations:check` never writes a credential value
  (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_SECRET_KEY`) to stdout or stderr, on any
  code path including the failure path.
- **AS-004** — `npm run migrations:check` exits non-zero with an explanatory
  message (not a stack trace) when `SUPABASE_ACCESS_TOKEN` or
  `SUPABASE_PROJECT_REF` is absent from the environment.
- **AS-005** — A verifier reports every table name bound by a `postgres_changes`
  subscription anywhere in `components/` or `lib/`, and fails when any of those
  tables is absent from the `supabase_realtime` publication on the linked
  project.
- **AS-006** — The verifier in AS-005 discovers table names from the source tree,
  not from a hand-maintained list, so a new subscription added later is checked
  without editing the verifier.

## Realtime channel isolation (M1)

- **AS-007** — `subscribeToMyTasksRealtime` opens the `task_assignees` binding and
  the `tasks` binding on two distinct Realtime channels with distinct topics.
- **AS-008** — With the `task_assignees` binding dead (its table unpublished), a
  `tasks` UPDATE for a tracked task still reaches `onUpdate`.
- **AS-009** — With the `tasks` binding dead, a `task_assignees` INSERT for the
  current user still reaches `onAssigned`.
- **AS-010** — The unsubscribe function returned by `subscribeToMyTasksRealtime`
  releases both channels; no channel survives a caller's unmount.
- **AS-011** — The tracked-task-id set is shared across both channels, so an
  assignment arriving on one channel makes `tasks` events for that id
  deliverable on the other.

## Portal optimistic approve (M2)

- **AS-012** — Clicking Approve in `PortalApprovalActions` renders the approved
  state before `approvePortalTask` resolves.
- **AS-013** — When `approvePortalTask` returns `{ ok: false }`, the UI returns to
  the pre-click state and a sonner error toast carrying the action's own message
  is shown.
- **AS-014** — When `approvePortalTask` throws, the UI returns to the pre-click
  state and a sonner error toast is shown; nothing is left in a permanently
  pending state.
- **AS-015** — A second Approve click while the first is in flight does not issue
  a second `approvePortalTask` call.
- **AS-016** — Request-changes submission is optimistic on the same terms
  (AS-012–AS-015 equivalents), and an empty/whitespace-only message still issues
  no server call.

## Portal realtime (M2)

- **AS-017** — `client_requests` is a member of the `supabase_realtime`
  publication on the linked project.
- **AS-018** — On the portal overview, a task whose `pending_client_approval`
  flips to false leaves the "Waiting on you" list without a page reload.
- **AS-019** — On the portal overview, a task whose `pending_client_approval`
  flips to true and which is `client_visible` appears in "Waiting on you"
  without a page reload.
- **AS-020** — A realtime row whose `client_visible` is false is never rendered on
  any portal surface, even if it reaches the client.
- **AS-021** — On the portal project page, a task's status or title change is
  reflected in the task list without a page reload.
- **AS-022** — On the portal project page, a task that is deleted or becomes
  client-invisible disappears from the list without a page reload.
- **AS-023** — On the portal requests page, an inserted or status-changed
  `client_requests` row is reflected in the list without a page reload.
- **AS-024** — Every portal realtime subscription is torn down on unmount; no
  channel leaks across navigations.

## Board optimistic-move / realtime-echo race (M3)

- **AS-025** — A realtime `tasks` UPDATE echoing a drag whose Server Action has
  not yet resolved does not move the card away from its optimistic position.
- **AS-026** — Once the drag's Server Action resolves successfully, subsequent
  realtime updates for that task are applied normally.
- **AS-027** — When the drag's Server Action fails and the board rolls back, the
  pending-move guard is released, so later realtime updates for that task are
  applied normally.
- **AS-028** — A realtime update for a task with no in-flight move is applied
  immediately, unchanged from current behaviour.

## Portal end-to-end (M3)

- **AS-029** — A Playwright spec signs in as a client, opens the portal overview,
  sees a task in "Waiting on you", approves it, and observes the row leave the
  section without issuing a page reload.
- **AS-030** — The portal E2E spec creates and removes its own fixture data and
  leaves no residue that affects a subsequent run.

## Global gates

- **AS-031** — `npx tsc --noEmit` exits 0.
- **AS-032** — `npm run lint` reports no new errors relative to the mission's
  baseline commit.
- **AS-033** — The full unit and component test suite (every file outside
  `tests/integration/**` and `tests/e2e/**`) passes.
- **AS-034** — No new test added by this mission requires a live Supabase
  connection.
