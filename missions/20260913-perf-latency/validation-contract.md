# Validation contract — Request latency under /w/*

_Mission: 20260913-perf-latency_
_Status: APPROVED. Immutable thereafter._

Flat, numbered, falsifiable. Every assertion is assigned to at least one
feature in `plan.md`. Never edit or delete an ID after approval; append new
IDs instead.

A note on what is asserted. Wall-clock milliseconds are not assertable — they
move with network weather, and this mission's own measurements varied by a
factor of eight between passes on the same route. Every assertion below is
therefore about **countable structure**: how many times a call is made, what a
query filters on, what has resolved before a render returns. Structure is what
the mission changes; the milliseconds follow from it.

---

## Request-level deduplication

AS-001: One render of the workspace layout issues at most one `auth.getUser()` call.
AS-002: One request that renders the workspace layout and a project page fetches the workspace row by slug at most once.
AS-003: `getCurrentUser()` called twice within one request returns the same object identity and issues one network call.
AS-004: A query helper that resolves the caller's identity accepts a caller-supplied user id and issues no auth call when one is supplied.
AS-005: A request carrying no Supabase session cookie completes the proxy without calling the auth endpoint.
AS-006: Every route that redirected a signed-out visitor to `/sign-in` before this mission still redirects them.
AS-007: One render of a chat route executes the workspace channel-list chain at most once.

## Query narrowing

AS-008: `getWorkspaceStatusOptions` constrains `project_statuses` by an explicit project id list.
AS-009: `getWorkspaceListTasks` constrains `tasks` by an explicit project id list, not only by a join predicate on `projects`.
AS-010: `getMyTasks` drives its outer scan from the assignee side rather than from `tasks`.
AS-011: Each narrowed query returns the same set of rows, in the same order, as it returned before narrowing.

## Badge counters

AS-012: The sidebar unread-message badge is produced by one database call.
AS-013: The sidebar approvals badge is produced by one database call.
AS-014: The sidebar client-requests badge is produced by one database call.
AS-015: Each badge displays the same number it displayed before this mission, for the same data.

## Streaming shell

AS-016: The workspace layout returns its JSX after at most two awaited database round trips.
AS-017: Every sidebar figure that is not required to render the navigation resolves inside a Suspense boundary.
AS-018: The sidebar's navigation links are present in the first flushed chunk of the response, before any badge figure has resolved.
AS-019: A route segment under `projects/[projectId]` has its own `loading.tsx`.
AS-020: A Suspense fallback occupies the same footprint as the resolved figure it replaces, so no layout shift occurs when it resolves.

## List route

AS-021: A request to the list page that has a default saved view returns a rendered page, not a redirect.
AS-022: The view applied without the redirect is the same view the redirect previously selected.

## Non-regression

AS-023: `npm run test` passes.
AS-024: `npm run lint` passes.
AS-025: No page touched by this mission changes what it displays, what it accepts, or how it responds to input.
AS-026: `resolveClientBucket` in `components/portal/status-label.ts` is byte-identical to its state at mission start.
AS-027: Database changes are additive only — no existing function, policy, index, table or column is dropped or altered.
AS-028: A signed-out visitor, a viewer, a guest, a client and an owner each see exactly what they saw before this mission.
