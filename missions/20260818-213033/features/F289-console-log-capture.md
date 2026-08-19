# F289: capture console output

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F288

## Assertion IDs covered
- AS-550: console errors and warnings are attached to the report
- AS-551: capture is bounded
- AS-552: the limitation is stated plainly

## Draft scope
- Content script injected at `document_start` in the MAIN world, wrapping `console.error/warn/log` and `window.onerror` / `unhandledrejection` into a fixed-size ring buffer (e.g. last 200 entries, truncated payloads).
- The UI states that only messages produced after injection are captured — the same limitation every tool in this category has.
- Serialisation must survive circular structures and DOM nodes without throwing.

## Files (approximate)
extension/src/capture/console-hook.ts, extension/src/capture/ring-buffer.ts

## Notes for clarification
- Wrapping console on every page has a cost and a privacy dimension; gate it behind the toggle from F291 and default it deliberately.
- MCP at run: none.
