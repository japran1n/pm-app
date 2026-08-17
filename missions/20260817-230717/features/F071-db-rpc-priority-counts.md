# F071: db rpc priority counts

**Milestone:** M7 — Dashboard
**Estimated worker time:** 25 minutes
**Depends on:** F033

## Assertion IDs covered
- AS-125
- AS-127
- AS-128
- AS-129

## Draft scope
- Postgres RPC/view: task counts grouped by priority for a workspace, excluding deleted tasks and archived projects by default

## Files (approximate)
supabase/migrations/xxxx_rpc_priority_counts.sql

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
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
