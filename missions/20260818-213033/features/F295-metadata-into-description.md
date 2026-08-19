# F295: render captured metadata into the task

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F288, F289, F290, F293

## Assertion IDs covered
- AS-560: the description contains the technical metadata in a readable form

## Draft scope
- Metadata rendered as a structured block appended after the reporter's own description: URL, browser, OS, viewport, DPR, element selector, and collapsed console/network excerpts.
- Uses the rich-text document format from M14 (F170) when available; falls back to plain text and says so in the handoff if M14 has not landed.
- The reporter's own words come first — the machine detail must not bury them.

## Files (approximate)
extension/src/submit/describe.ts, lib/editor/schema.ts

## Notes for clarification
- Long console dumps belong in an attachment or a collapsed block, not inline in the description.
- MCP at run: none.
