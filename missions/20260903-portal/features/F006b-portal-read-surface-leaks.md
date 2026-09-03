# F006b: Close the portal read-surface leaks

**Milestone:** M1 remediation — **highest priority in the mission**
**Estimated worker time:** 2 h
**Depends on:** F001–F006
**Opened by:** the M1 scrutiny review, orchestrator-verified

## The defects

Confirmed by reading the code, not inferred:

1. **`getPortalProjectOptions` (`lib/queries/portal.ts` ~736) and
   `getPortalRequests` (~684)** filter `projects` on `workspace_id` and
   `deleted_at` only. **No `portal_enabled`.** Both are live on
   `p/[projectId]/requests/page.tsx`. A client who belongs to Project A
   (portal on) and Project B (portal off) sees B's name in the request
   form's project select and B's `client_requests` rows in the list.
   `client_requests_insert_own` was never folded either, so they can
   file a request against a project that is supposed to be invisible.

   `getPortalProjects`'s own comment explains that this filter is the
   gate. It was added in exactly one of the three places that needed it.

2. **`lib/queries/portal.ts:552`** —
   `admin.from("project_phases").select("id, name").in("id", phaseIds)`
   — service-role client, **no `client_visible` filter**. A
   non-client-visible phase's name is rendered in the overview's
   Live-now rail whenever a timer runs on an internal task inside it.
   The existing unit test's fixture has no `client_visible` field and
   asserts the name *is* shown, so it locks the defect in.

## Assertion IDs covered
- AS-007: A client whose project has `portal_enabled = false` receives a 404 for that project's portal routes, and its rows are not returned by any portal query.
- AS-012: A phase with `client_visible = false` appears in neither the portal timeline nor any portal progress figure.

## Scope

1. **Audit every read in `lib/queries/portal.ts`.** Not just the two
   named above — enumerate every function that touches `projects`,
   `tasks`, `project_phases`, `client_requests` or `attachments`, and
   confirm each applies the full gate: workspace membership,
   `portal_enabled`, and the entity's own `client_visible`. Write the
   enumeration into the handoff so the next reader can check your work
   rather than re-deriving it.
2. **Fix `client_requests_insert_own`** so a client cannot file against
   a portal-disabled project. Forward-only migration.
3. **Fix the phase-name read** — filter `client_visible`, and return
   the phase's name only when it passes. When it does not, the Live-now
   rail says what F006's spec already required for internal tasks: a
   generic phrase, no name.
4. **Fix the test that locked the defect in.** Its fixture must carry
   `client_visible` and it must assert the name is *absent* for a
   hidden phase. A test whose fixture cannot express the condition it
   claims to check is worse than no test.
5. **Prefer RLS over query filters where the row is client-readable at
   all.** A filter in one query is a filter someone forgets in the next
   one — which is exactly what happened here. If the gate can live in a
   policy, put it there and keep the query filter as belt-and-braces.

## Definition of done

- **Primary success test:** integration, with the two-project fixture
  the scrutiny report names — a client of Project A (portal on) and
  Project B (portal off) sees no trace of B: not its name, not its
  requests, not its phases, through any portal query or route.
- **Failure test:** that client attempting to insert a `client_request`
  against B is rejected by the policy, proven by calling PostgREST
  directly rather than through the UI.
- **Manual verification:** the enumeration in the handoff lists every
  read function in `lib/queries/portal.ts` with its gate.
- **Side-effect verification:** the portal still works normally for a
  single-project client; F003/F005/F006 tests pass.
