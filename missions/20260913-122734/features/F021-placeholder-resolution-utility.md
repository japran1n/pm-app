# F021: Placeholder resolution utility

**Milestone:** M5 — Placeholders DB
**Estimated worker time:** 35 minutes
**Depends on:** F020

## Assertion IDs covered
- AS-044, AS-045, AS-046, AS-047, AS-048, AS-049, AS-050, AS-051, AS-052, AS-053, AS-054, AS-055, AS-056, AS-064

## Draft scope
- Create `lib/docs/placeholders.ts`
- `AUTO_PLACEHOLDER_MAP: Record<string, ProjectLinkKind>` — maps key name → project_links kind
- `resolvePlaceholders({ content, projectId, mode: 'team' | 'client' }): string`
  - Fetch auto-resolved values from project_links
  - Fetch manual values from doc_placeholder_values
  - For 'team' mode: replace resolved `{{key}}` with value; wrap unresolved in `<mark data-unresolved="key">{{key}}</mark>`
  - For 'client' mode: replace resolved with value; replace unresolved with '' (empty string)
- Export `KNOWN_PLACEHOLDER_KEYS: string[]` (union of auto + manual)

## Files (approximate)
- `lib/docs/placeholders.ts`
- `tests/unit/placeholder-resolution.test.ts`

## Notes for clarification
- MCP at run: none (pure utility, takes pre-fetched data or calls server client)
- The `<mark>` approach for team mode lets CSS handle the yellow highlight without JS
