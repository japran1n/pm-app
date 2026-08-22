# Handoff: F200 — toggle a reaction

## Status
COMPLETE

_Note: the worker that wrote this feature's code stalled (no progress for 600s) before
writing its own handoff or committing. The orchestrator read the code it left behind,
independently verified it (tsc, eslint, and the full test file against the real linked
Supabase project), found it complete and correct, and is writing this handoff and
committing on the worker's behalf rather than discarding solid, already-verified work._

## Assertions covered
AS-367: PASS — `tests/integration/toggle-reaction.test.ts` (6/6, run by the orchestrator against
the real linked Supabase project): toggling on inserts a row; toggling again (double-toggle)
removes it and the row is genuinely gone; two rapid/concurrent toggle attempts for the same
user+comment+emoji do not crash on the unique-constraint violation and converge to a single
correct end state; an invalid emoji outside F199's allow-list is rejected before reaching the
database; a viewer is rejected by the `canWrite` gate; an unauthenticated caller is rejected.

## Files changed
lib/actions/comment-reactions.ts (new)
lib/validation/comment-reactions.ts (new)
tests/integration/toggle-reaction.test.ts (new)

## Commands run (by the orchestrator, after the worker stalled)
`npx tsc --noEmit` (0)
`npx eslint .` (0 errors; 2 pre-existing unrelated warnings in lib/queries/search.ts and
tests/unit/invite-member-pagination.test.ts, unchanged by this feature)
`npx vitest run tests/integration/toggle-reaction.test.ts` (0) — 6/6 passed against the real
linked Supabase project

## Decisions made (read from the code's own doc comments, written by the stalled worker)
- **Toggle implementation: always attempt INSERT first, catch Postgres unique-violation
  (23505) to know a DELETE is needed instead**, rather than a client-side read-then-branch.
  This makes the composite primary key from F199 (`comment_id, user_id, emoji`) the actual
  race-safety mechanism: two concurrent toggle calls for the same caller+comment+emoji both
  attempt INSERT; the database decides which one "wins," and the other's unique-violation is
  caught and converted into a DELETE rather than crashing or double-inserting. Documented
  explicitly in the action's own comment, and proven by a dedicated concurrent-toggle test.
- **Access control: `canWrite` gate, not just RLS SELECT visibility** — reacting is a content
  mutation like commenting, not a read-only preference like watching, so a viewer can see
  reactions but not add/remove one. Mirrors `addComment`'s own gate.
- **Writes go through the caller's own authenticated session (not the admin client)**, so
  F199's self-only RLS INSERT/DELETE policies remain the real enforcement boundary — mirrors
  `watchTask`/`unwatchTask`'s established self-serve-via-own-session pattern.
- **Zod validation mirrors F199's DB-level emoji CHECK constraint verbatim** (the same
  six-emoji allow-list), so an invalid emoji is rejected with a friendly message before ever
  reaching Postgres.

## Out-of-scope work needed
- UI wiring (reaction chips, emoji picker) is F201, not this feature.
- Live/realtime reaction delivery to other viewers is F202, not this feature.

## Blockers
(none — Status is COMPLETE; see the note at the top about how this handoff came to be written)

## Notes for the next worker
- This action is ready for F201 (reaction UI) to call directly — its return shape is
  `{ ok: true, data: { commentId, emoji, reacted } } | { ok: false, error }`.
- `REACTION_EMOJI_ALLOWLIST` (`lib/validation/comment-reactions.ts`) is the single source of
  truth for which emoji are offered — F201's emoji picker should import and iterate this
  constant rather than hardcoding a second copy of the list.
