# F045: Migration — revision trigger and append-only policies

**Milestone:** M6 — Brief: schema and team side

**Est:** 45 min · **Depends on:** F044
**Covers:** AS-127, AS-133, AS-134, AS-135
- Before-update trigger writes the old value; no UPDATE or DELETE policy for anyone


## Clarification status

`[CLARIFIED-AUTO]` — resolved by `clarifications/standing-decisions.md` plus this mission's discovery rounds. No open questions.

## Notes for the worker
- MCP at run: Supabase MCP for schema reads and migrations; no other MCP.
- Read `clarifications/standing-decisions.md` before starting.
- Every assertion listed under **Covers** must be verifiably true when you finish.
