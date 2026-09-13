# F022: Project settings — placeholder values form

**Milestone:** M6 — Placeholders UI
**Estimated worker time:** 30 minutes
**Depends on:** F020, F021

## Assertion IDs covered
- AS-057, AS-058, AS-059, AS-060

## Draft scope
- New section in project settings (workspace side): "Placeholder values"
- Fetch auto-resolved values (from project_links — read-only display)
- Fetch manual values from doc_placeholder_values (editable)
- Form: one field per KNOWN_PLACEHOLDER_KEYS; auto-resolved shown as disabled input with "From project links" label; manual as editable text input
- Save action: upsert doc_placeholder_values rows (UPSERT ON CONFLICT DO UPDATE)
- Revalidate project settings page on save

## Files (approximate)
- `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/settings/page.tsx` (extend)
- `components/project-settings/placeholder-values-form.tsx`
- `lib/actions/placeholder-values.ts`
- `lib/queries/placeholder-values.ts`

## Notes for clarification
- MCP at run: none
