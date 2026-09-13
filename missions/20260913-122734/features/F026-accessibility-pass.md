# F026: Accessibility and performance pass

**Milestone:** M7 — Polish & QA
**Estimated worker time:** 20 minutes
**Depends on:** F004, F005, F024

## Assertion IDs covered
- AS-013, AS-014, AS-068, AS-069

## Draft scope
- Verify every YouTube iframe has a non-empty `title` attribute matching the link title (AS-014, AS-068)
- Verify `loading="lazy"` present on all iframes (AS-013)
- Run eslint-plugin-jsx-a11y on new components — fix any violations
- Verify no new `img` without `alt` introduced
- Manual check: tab through how-we-work page in dev server, confirm iframes are focusable and titles are announced

## Files (approximate)
- No new files — fixes in existing components if needed

## Notes for clarification
- MCP at run: none
