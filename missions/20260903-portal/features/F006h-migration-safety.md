# F006h: A migration that fails on a fresh database blocks every deploy

**Milestone:** M1 remediation, round 2 — **deploy blocker**
**Estimated worker time:** 1.5 h
**Opened by:** the M1 re-scrutiny

## The defects

1. **`20260915020000_task_type_system_key_backfill_widen.sql:38-55`**
   uses `distinct on (workspace_id)` to de-duplicate among *candidates*,
   but never excludes workspaces that already hold a
   `system_key = 'page'` row. Every workspace created since
   `20260912010000` is seeded with exactly such a row. Add any untagged
   `Pages` / `Sida` / `Stranica` type and the UPDATE hits
   `task_types_workspace_id_system_key_idx`, raises 23505, and
   `scripts/apply-migration.mjs` never records the version — the deploy
   stops.

   It applied cleanly here because this database happened not to hold
   that combination. It is exactly the Swedish-agency shape the
   migration was written for, and CI cannot catch it because migrations
   replay against an empty `task_types`.

2. **`create_project_from_template` drops `client_visible`** on the
   round trip (`lib/actions/templates.ts:881-885` and
   `20260915010000:119-130`). A phase deliberately hidden from the
   client comes back visible in every project made from that template.
   Templates without a phases section are fine — `default '[]'` plus
   `coalesce`, verified.

## Assertion IDs covered
- AS-009: A project created from a project template receives that template's phases in the same transaction as the project itself.
- AS-012: A phase with `client_visible = false` appears in neither the portal timeline nor any portal progress figure.

## Scope

1. Make the backfill collision-safe. It has already been applied to the
   live database, so decide deliberately between a corrective
   forward-only migration and editing the applied file, and **write your
   reasoning in the handoff**. The test the decision must pass: a fresh
   database with a seeded `page` type plus an untagged "Sida" type
   migrates cleanly to head. Prove it, do not assert it.
2. Carry `client_visible` through the template payload, the save action
   and the RPC. A hidden phase stays hidden.
3. Add a regression test that runs the full migration chain against a
   database seeded with the colliding shape.

## Definition of done

- **Primary success test:** the colliding-shape database migrates to
  head with no error.
- **Failure test:** a template saved from a project with a hidden phase
  produces a project whose phase is still hidden.
- **Manual verification:** state in the handoff which approach you took
  to the applied migration and why.
- **Side-effect verification:** templates without phases still create
  projects; the live database is unchanged in effect.
