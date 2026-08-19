# F284: capture a selected region

**Milestone:** M19
**Estimated worker time:** 45 minutes
**Depends on:** F283

## Assertion IDs covered
- AS-540: the user can capture a region instead of the whole visible area

## Draft scope
- Content-script overlay for drag-to-select with a dimmed backdrop and live size readout; Escape cancels.
- Crop applied to the full-tab capture rather than a second capture, so the two paths cannot diverge.
- Keyboard alternative: capture full view, then crop in the annotation stage.

## Files (approximate)
extension/src/capture/region-overlay.ts, extension/src/capture/crop.ts

## Notes for clarification
- The overlay must not be capturable by its own screenshot — capture first, then overlay, or hide before capturing.
- MCP at run: none.
