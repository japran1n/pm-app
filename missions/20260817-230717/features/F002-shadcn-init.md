# F002: shadcn init

**Milestone:** M1 — Foundation
**Estimated worker time:** 30 minutes
**Depends on:** F001

## Assertion IDs covered
- (none — foundation/skeleton feature)

## Draft scope
- Run `npx shadcn@latest init`
- Add base components: button, input, card, dialog, sheet, dropdown-menu, avatar, badge, tabs, table, sonner
- Verify Tailwind config and globals.css are wired correctly

## Files (approximate)
components/ui/*, tailwind config, app/globals.css

## Notes for clarification
shadcn CLI v4 writes components directly into the repo — commit the generated files as-is, do not hand-edit generated primitives.
- MCP at run: none
