# F025: The leak sweep

**Milestone:** M5
**Estimated worker time:** 3 h
**Depends on:** every other feature

## Assertion IDs covered
- AS-054: For every table added by this mission, a row that is not client-visible is absent from direct selects, from aggregates and counts, and from every RPC response.
- AS-055: A client session that walks every portal route returns no internal-only field in any response payload.

## Scope

### 1. Per-table triple

For every table this mission added — `project_phases`,
`approval_requests`, `project_decision_owners`, `client_deliverables`,
`project_scope_items`, `project_decisions`, `project_assumptions`,
`project_budgets`, `project_metrics`, `metric_snapshots`,
`project_improvements`, `project_links`, `project_accounts` — three
tests as a real client session:

1. a non-visible row is absent from a direct select;
2. it does not shift any count or aggregate the portal renders;
3. it is absent from every RPC that touches the table.

Derive the table list from the migrations rather than hard-coding it, so
a table added later without tests fails this suite instead of slipping
past it.

### 2. The route walk

One integration test that signs in as a client and requests every route
under `app/(portal)`, asserting that no response payload contains any of:
an internal comment body, a time-entry note, a non-client-visible task
title, a `quoted_amount` on an unsent quote, a risk, an audit row, or
the string of any credential-shaped field.

Assert on the **serialised payload**, not on named fields. A leak
arrives through a field nobody thought to check, which is precisely the
field a named assertion omits.

### 3. Route enumeration

Enumerate the routes by walking the filesystem under `app/(portal)`, not
from a list in the test. A route added in six months must be covered the
day it appears, without anyone remembering to add it here.

### 4. What to do with findings

Every leak found is fixed in this feature if the fix is a policy or a
query filter. If a leak reveals a design mistake — a table whose shape
makes leaking easy — write it in the handoff and open it as a finding
rather than patching around it.

## Definition of done

- **Primary success test:** the full sweep passes with the derived table
  list and the walked route list.
- **Failure test:** temporarily mark one row client-visible in a
  fixture, confirm the sweep fails, revert. Say in the handoff that you
  did this — a sweep that has never failed has not been shown to work.
- **Manual verification:** the table list and route list are derived,
  not literal — check by adding a dummy migration locally and confirming
  the suite notices, then removing it.
- **Side-effect verification:** the sweep runs in CI time (under two
  minutes) or is split so it can.
