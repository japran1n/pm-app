# F006d: Close the three authorisation gaps

**Milestone:** M1 remediation
**Estimated worker time:** 2 h
**Depends on:** F002, F002b
**Opened by:** the M1 scrutiny review, orchestrator-verified

## The defects

1. **`bulkSetTaskPhase` (`lib/actions/phases.ts` ~715–821)** selects
   `projects!inner(…, visibility)` but drops `visibility` from its own
   `TaskRow` type and never checks it. Its cited precedent,
   `bulkUpdateTasks` (`lib/actions/tasks.ts` ~3994–4039), performs the
   private-project check that this one skips. Consequence: a workspace
   member who is not a member of a private project can write `phase_id`
   onto that project's tasks, through the service-role client.

   Note the shape: the query was written to fetch the field the check
   needed, and the check was never written. That is the most dangerous
   near-miss in the mission so far, because it reads as complete.

2. **`seed_default_phases`** gates with a `= 'client'` deny-list where
   its cited precedent uses an allow-list. A `viewer` can therefore
   insert phases by calling the RPC directly.

3. **`create_channel_atomic`**, dropped and re-created in F002b's
   migration `20260910010000`, sets `search_path = public` — **without
   `pg_temp`**. Every other function this mission touched pins it
   correctly; this one regressed a hardening that migration
   `20260908010000` exists to guarantee.

## Assertion IDs covered

None directly — these protect AS-054 and the mission's general rule
that authorisation is enforced server-side.

## Scope

1. Add the private-project visibility check to `bulkSetTaskPhase`,
   matching `bulkUpdateTasks`'s behaviour exactly, including what it
   does with tasks the caller may not touch (skip them, or fail the
   batch — do whatever the precedent does, and say which in the
   handoff after reading it).
2. Convert `seed_default_phases` to the allow-list form its precedent
   uses.
3. Re-issue `create_channel_atomic` with `set search_path = public,
   pg_temp`, forward-only, preserving the signature F002b settled on
   and its grants.
4. **Then sweep:** every SECURITY DEFINER function this mission has
   added or replaced, checked for the `pg_temp` pin. List them in the
   handoff with a tick each. One regression means the sweep is worth
   doing properly rather than spot-checking.

## Definition of done

- **Primary success test:** integration — a workspace member who is not
  a member of a private project cannot set a phase on its tasks through
  `bulkSetTaskPhase`, called directly.
- **Failure tests:** a `viewer` calling `seed_default_phases` directly
  is rejected; `create_channel_atomic`'s `proconfig` shows `pg_temp`.
- **Manual verification:** the handoff carries the full SECURITY
  DEFINER sweep list.
- **Side-effect verification:** chat channel creation still works; F002
  bulk-phase tests still pass.
