# Validation Contract — Mission 20260903-portal

_Locked on approval. New assertions may be appended; existing IDs never
edited or deleted._

---

## Portal shell

AS-001: The client portal renders a persistent left sidebar listing Overview, Approvals, Your list, Pages, Hours, Results, Scope & decisions, and Your site.
AS-002: The sidebar shows a numeric badge on Approvals equal to the number of approval requests currently awaiting this client's decision.
AS-003: The sidebar shows a numeric badge on Your list equal to the number of the client's deliverables that are past their due date.
AS-004: Navigating between portal views changes the URL and the browser back button returns to the previous view.
AS-005: The portal header displays the project's target launch date and its current launch confidence.
AS-006: A team member who opens any portal URL is redirected into the team app instead of seeing the portal.
AS-007: A client whose project has `portal_enabled = false` receives a 404 for that project's portal routes, and its rows are not returned by any portal query.

## Phases

AS-008: Each project can hold an ordered list of phases, each with a client-facing name, description, state, and planned dates.
AS-009: A project created from a project template receives that template's phases in the same transaction as the project itself.
AS-010: The portal renders a phase timeline that shows more than one phase in the active state simultaneously when more than one phase is active.
AS-011: A phase's progress figure counts only tasks that are marked visible to the client.
AS-012: A phase with `client_visible = false` appears in neither the portal timeline nor any portal progress figure.
AS-013: A team member can assign a task to a phase from the task detail sheet, and the assignment survives a reload.

## Pages view

AS-014: The portal Pages view lists every client-visible task of type `page` for the project, ordered by the page order defined by the team, not by creation date.
AS-015: Each page row shows the same status the team sees, with no second mapping that can diverge.
AS-016: Hovering a page status reveals a client-facing explanation of that status, read from the database rather than hard-coded in the UI.
AS-017: The Pages view shows a distribution bar summarising how many pages are waiting on the client, in progress, blocked, and ready to launch, with each count also stated in text.
AS-018: Filtering the pages table by status hides non-matching rows without a page reload.

## Approvals

AS-019: A team member can create an approval request from a task, from a document, or standalone with an external artifact URL.
AS-020: Creating an approval request against a task that is not client-visible is rejected at creation time with an explicit error.
AS-021: The portal shows every open approval request for the client's projects, with what is being approved, who must decide, and its due date.
AS-022: A client who is not the named decision owner for an approval's decision type cannot record a decision, and the rejection is enforced server-side, not only by a disabled control.
AS-023: Approving a request records the decider, the timestamp, and the decision in one transaction, and clears the linked task's pending-approval flag.
AS-024: A recorded approval decision cannot be edited or deleted; a changed mind requires a new approval request.
AS-025: Requesting changes on an approval requires a comment and creates a task in the project carrying that comment.
AS-026: The portal shows the full decision history for the project, including who decided and when.
AS-027: The team app has a queue listing every open approval request across projects, ordered by how long it has been waiting.

## Client deliverables (Your list)

AS-028: A project can hold a list of items the client owes, each with a kind, owner name, due date, blocking flag, and state.
AS-029: The portal Your list view shows delivered-and-accepted items separately from open and past-due items.
AS-030: An item the client has uploaded remains counted as outstanding until a team member accepts it.
AS-031: A blocking deliverable that is past its due date is surfaced on the portal overview, not only inside its own view.
AS-032: A team member can accept a deliverable or return it with a required comment, and the client sees which happened.

## Hours

AS-033: A project can record a budget of sold hours for a period.
AS-034: The portal Hours view shows cumulative billable hours used against the planned curve, week by week.
AS-035: The portal's hours figures exclude every non-billable time entry.
AS-036: No portal hours response contains a time entry's note or the name of the person who logged an individual entry.
AS-037: Hours logged against tasks that are not client-visible are included in the totals but are reported without the task's name.
AS-038: The portal shows hours broken down by work category, and every category shown has a stated value.

## Results

AS-039: A project can record baseline metrics with a value, a unit, a target, and a measurement source.
AS-040: Once a project's baseline is frozen, its baseline values can no longer be changed; later measurements are recorded as separate snapshots.
AS-041: A metric with no post-baseline snapshot is presented as not yet measured rather than as an improvement.
AS-042: The portal Results view renders each metric as a before/after comparison against its target.

## Scope, decisions, assumptions

AS-043: A project can record scope items marked as included or excluded, each with its source.
AS-044: A project can record decisions, each with a rationale, a decision type, a date, and a client-visibility flag.
AS-045: A decision marked not client-visible is absent from every portal response.
AS-046: A project can record assumptions with a confirmation state, and the client can flag one as incorrect from the portal.
AS-047: A client request classified as a change request cannot become a task until the client has approved its quote, enforced inside the database function rather than in the UI.
AS-048: The portal shows each change request with its estimate, price, and current state.

## Site & guides

AS-049: A project can record links (staging, live, design file, sitemap, other) with per-link client visibility.
AS-050: A project can record accounts with an owner and a transfer status, and no field in that record accepts a credential value.
AS-051: A document can be marked visible to the client and given a kind, and only client-visible documents appear in the portal's guides list.

## Trust boundary

AS-052: An owner or admin can view the portal exactly as a specific client sees it, and that view is produced through the client's own permissions rather than by bypassing them.
AS-053: Every entry into the client-preview view is written to the audit log.
AS-054: For every table added by this mission, a row that is not client-visible is absent from direct selects, from aggregates and counts, and from every RPC response.
AS-055: A client session that walks every portal route returns no internal-only field in any response payload.

## Task types (F116)

AS-056: A workspace carries six system task types identified by stable keys — page, delivery, qa, client_request, change_request, improvement — each resolvable independently of its human-editable name.
AS-057: After migration, no live task is left without a task type.
AS-058: A task cannot be created without a task type.
AS-059: Each system task type carries a fixed billable flag, and no workspace-level write can change it.
AS-060: A task created with a given type receives that type's default client visibility as its initial value only.
AS-061: A task's own client_visible flag remains the sole gate on portal exposure; a task type never widens it.
AS-062: A project reports tracked and estimated time grouped by task type.
AS-063: Accepting a client request produces a task typed client_request, and raising a change request produces one typed change_request.

## Task type picker in UI (F118)

AS-064: A task created through the New Task dialog carries the task type the user picked in that dialog.
AS-065: A task created through a board or list quick-add carries the task type the user picked, when the entry point exposes a picker.
AS-066: An existing task's type can be changed from the task detail view, and the change is visible immediately without a page reload.
AS-067: Changing a task's type never changes that task's own client_visible flag.
AS-068: A project's overview or settings surface displays tracked and estimated hours grouped by task type, sourced from rpc_project_time_totals.

## Sidebar cramped on short viewports (F119)

AS-069: On a viewport short enough that the primary nav plus header and footer leave little vertical room, the workspace sidebar's project list is independently scrollable and every project remains reachable by scrolling, rather than being visually compressed or cut off.

## Chat regressions from the parity merge (F120)

AS-070: A message sent by a workspace member appears exactly once in the channel and in any thread it belongs to, both immediately after sending and after a page reload.
AS-071: A message consisting of or containing a bare URL renders that URL as a clickable link.
AS-072: A message containing a URL to a page with retrievable Open Graph metadata shows a preview card (at minimum a title) below the message text; a message whose URL has no retrievable metadata still renders as a plain clickable link per AS-071, with no error surfaced to the user.
AS-073: Scrolling within an open channel's message list does not scroll the surrounding page, and the channel's own toolbar remains visible and in the same position regardless of scroll position within the message list.

## Links render but are inert (F121)

AS-074: A link inside read-only rendered rich text (chat message, task comment, task description) is visually distinguishable from surrounding text and opens its target when clicked, while a link inside the editable editor still does not navigate on click.
AS-075: components/editor/rich-text-editor.tsx contains no raw control bytes, so ordinary text tooling reads it as text rather than binary.

## Link marks stored without an href (F122)

AS-076: A chat message containing a bare URL is stored with a link mark that carries a usable href, regardless of whether the client editor already applied a link mark of its own.
AS-077: A link mark that arrives carrying no usable href is repaired rather than skipped, so the resulting message renders as an anchor.
AS-078: A message whose stored link mark has no href still renders its text safely with no anchor, and no href is invented for it on read.

## Rich text crosses the server boundary as plain data (F123)

AS-079: A chat message body is serialised to plain JSON on the client before it is passed to a server action, so no server-side code ever dots into a client reference.
AS-080: Sending a message containing a URL completes without a runtime error and stores a link mark carrying that URL as its href.

## Authorization round-trip latency (F124)

AS-081: Authorization checks that do not depend on one another run concurrently, reducing the number of sequential network round trips before a wrapped action's handler runs, with no check removed or weakened.
AS-082: Every authorization refusal that held before this change still refuses, with the same error message, for every role and visibility combination already covered by tests.
AS-083: A request resolves the caller's authenticated identity at most once, rather than once per call site.
AS-084: The caller's identity is still established by the JWT-verifying user lookup; no unverified session read is substituted for it.
AS-085: A representative set of server actions is measured before and after, and the recorded numbers show the reduction rather than asserting it.

## Link preview refetching (F125)

AS-086: A URL whose preview has already been resolved is not fetched again on a subsequent render, by the same viewer or a different one, until its cached entry expires.
AS-087: A URL that yields no usable preview is remembered as such and is not refetched on every render.
AS-088: Resolving a link preview never delays the message from rendering.

## Test-suite auth pressure (F126)

AS-089: A full test run performs far fewer authentication operations than it has test files, by reusing pooled identities and cached sessions instead of creating and signing in a fresh user per file.
AS-090: Tests migrated to the shared auth helper assert the same behaviour as before, with no assertion weakened to accommodate a shared identity.
AS-091: Test data created by a migrated file is still removed when that file finishes, including when its tests fail.
