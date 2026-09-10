# F001: Derived colour tokens for component and CMS

**Milestone:** M1 — Foundation: tokens and schema

**Est:** 45 min · **Depends on:** none
**Covers:** AS-075, AS-076, AS-077, AS-078, AS-079, AS-080
- Add `--component-*` and `--cms-*` token groups (fill, border, border-hover, foreground)
- Derive from existing OKLCH knobs with a hue offset; no hand-written hex
- Define in `:root`, redefine under both the dark media query and `[data-theme="dark"]`
- Green reads as Webflow's component green, lilac as its CMS purple
**Files:** `app/globals.css`


## Clarification status

`[CLARIFIED-AUTO]` — resolved by `clarifications/standing-decisions.md` plus this mission's discovery rounds. No open questions.

## Notes for the worker
- MCP at run: Supabase MCP for schema reads and migrations; no other MCP.
- Read `clarifications/standing-decisions.md` before starting.
- Every assertion listed under **Covers** must be verifiably true when you finish.
