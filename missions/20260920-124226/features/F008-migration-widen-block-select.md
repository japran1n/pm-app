# F008: migration widen block select

**Milestone:** M2 — Database
**Estimated worker time:** 30 minutes
**Depends on:** none

## Assertion IDs covered
- AS-025: An active workspace member can read another active member's calendar blocks.
- AS-026: A calendar block attached to a project the viewer cannot otherwise see is still readable by any active member of that workspace.
- AS-027: Another member's block displays its real title, not a placeholder such as "Busy".
- AS-028: Someone who is not an active member of the workspace cannot read any of its calendar blocks.

## Draft scope
- Drop calendar_blocks_select_visible and recreate it as an active-workspace-member predicate.
- Remove the is_project_visible_to branch entirely.
- Leave the insert, update, and delete policies exactly as they are.
- Header comment states plainly that this WIDENS read access, and why.

## Files (approximate)
- `supabase/migrations/<ts>_calendar_blocks_workspace_wide_select.sql`

## Notes for clarification
Chosen in discovery 2.1(b) against description.md's 'nema izmene baze'. De-risked by 2.2(c): no private projects exist today. MCP at run: Supabase MCP to confirm the live policy before and after.
