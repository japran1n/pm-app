# F033: Hover-linked highlighting

**Milestone:** M4 — Components

**Est:** 45 min · **Depends on:** F032
**Covers:** AS-070, AS-071, AS-072, AS-073, AS-074
- `data-hover-component` on the board root, `data-component` on each card
- Highlight driven by a CSS selector, not React state — no re-render on hover
- Border and background only; no size, position or shadow change


## Clarification status

`[CLARIFIED-AUTO]` — resolved by `clarifications/standing-decisions.md` plus this mission's discovery rounds. No open questions.

## Notes for the worker
- MCP at run: Supabase MCP for schema reads and migrations; no other MCP.
- Read `clarifications/standing-decisions.md` before starting.
- Every assertion listed under **Covers** must be verifiably true when you finish.
