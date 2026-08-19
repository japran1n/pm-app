# F299: keyboard operability

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F296

## Assertion IDs covered
- AS-570: the popup is operable by keyboard alone

## Draft scope
- Full keyboard path: open popup, capture, choose a tool, place an annotation, fill the form, submit — without a mouse.
- Focus order, visible focus, and accessible names for every icon-only control (the canvas tool palette is the risk).
- The annotation canvas needs a keyboard-reachable alternative for placing and moving shapes, not only pointer drag.

## Files (approximate)
extension/src/popup/*, extension/src/annotate/*

## Notes for clarification
- If full keyboard annotation is impractical, state precisely what is not reachable rather than claiming AS-570 broadly.
- MCP at run: none.
