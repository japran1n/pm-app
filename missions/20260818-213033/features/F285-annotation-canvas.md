# F285: annotate the capture

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F284

## Assertion IDs covered
- AS-542: arrow, rectangle, freehand, and text tools
- AS-543: undo and redo
- AS-545: the annotated image is what gets attached

## Draft scope
- Canvas editor in the extension page: tool palette, colour, stroke width, undo/redo stack.
- Flatten to a single PNG on submit; the original is discarded (or kept only in memory) so the attached file is unambiguous.
- No external drawing library unless one is verified current at implementation time — a canvas plus pointer events covers these four tools.

## Files (approximate)
extension/src/annotate/canvas.tsx, extension/src/annotate/tools/*

## Notes for clarification
- Text tool needs an accessible input path, not only click-to-type on canvas (AS-570 checks keyboard operability).
- MCP at run: none.
