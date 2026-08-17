# F012: db schema rls workspaces

**Milestone:** M2 — Auth & Workspace
**Estimated worker time:** 30 minutes
**Depends on:** F011

## Assertion IDs covered
- AS-010
- AS-011
- AS-137
- AS-138
- AS-139

## Draft scope
- RLS enabled on workspaces + workspace_members
- Policy: only members can SELECT their workspace
- Policy: only members can SELECT workspace_members rows for their own workspace(s)

## Files (approximate)
supabase/migrations/xxxx_rls_workspaces.sql

## Notes for clarification
This is the foundational RLS pattern every later table's policies will copy (join through workspace_members on auth.uid()). Get this one right first.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Pattern:** one forward-only SQL file per feature in `supabase/migrations/`, applied via `supabase db push` against the linked project (`qcipqonnqajmazdbysow`).
- **Constraints:** fixed-value columns use a CHECK constraint (not a native Postgres enum), per tech-decisions.md.
- **Rollback:** hand-written down-migration in the same PR if this table already has production-shape data; not required for a brand-new table.
- **Data loss:** additive changes only unless the spec says otherwise; any destructive change is flagged in the handoff explicitly.
- **Failure handling:** if `supabase db push` fails, Status = BLOCKED with the exact CLI error in Blockers.
- **Naming:** snake_case columns; `created_at`/`updated_at` default to `now()` at the DB level; soft-delete filtering (`deleted_at IS NULL`) is enforced in RLS policies, not only app queries.
- **Indexing:** index any FK/lookup column this table's RLS policy will join through.

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
