# F004: Board read query

**Milestone:** M1 — Foundation: tokens and schema

**Est:** 45 min · **Depends on:** F003
**Covers:** AS-024, AS-026, AS-082, AS-083
- One query returning pages, their sections in order, linked components, instance counts
- No N+1; counts computed in SQL, zero-instance components included
- Unfiltered team reader plus client-filtered sibling, per the repo's existing pair convention
**Files:** `lib/queries/architecture.ts`

---

## M2 — Architecture board: render and edit


## Clarification status

`[CLARIFIED-AUTO]` — resolved by `clarifications/standing-decisions.md` plus this mission's discovery rounds. No open questions.

## Notes for the worker
- MCP at run: Supabase MCP for schema reads and migrations; no other MCP.
- Read `clarifications/standing-decisions.md` before starting.
- Every assertion listed under **Covers** must be verifiably true when you finish.
