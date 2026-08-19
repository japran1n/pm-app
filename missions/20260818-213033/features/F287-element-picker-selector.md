# F287: point at the element in question

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F283

## Assertion IDs covered
- AS-546: the reporter can point at an element and have it recorded
- AS-547: the record includes a CSS selector plus position and size

## Draft scope
- Content-script hover highlight; click records the element.
- Selector generation prefers a stable path (id, data-* attributes, nth-of-type fallback) and records its own confidence rather than pretending every selector is durable.
- Bounding box recorded in CSS pixels alongside the viewport size so it can be interpreted later.

## Files (approximate)
extension/src/capture/element-picker.ts, extension/src/capture/selector.ts

## Notes for clarification
- Shadow DOM and iframes are the known hard cases — decide whether they are supported or explicitly reported as unsupported.
- MCP at run: none.
