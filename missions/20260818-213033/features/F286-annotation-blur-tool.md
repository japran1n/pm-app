# F286: blur sensitive regions

**Milestone:** M19
**Estimated worker time:** 30 minutes
**Depends on:** F285

## Assertion IDs covered
- AS-544: a region can be blurred before sending

## Draft scope
- Blur applied destructively into the flattened PNG, never as a removable overlay — a "blur" that can be peeled off in the stored image is a data leak, not a feature.
- Test asserts the pixels under a blur differ from the original in the exported image.

## Files (approximate)
extension/src/annotate/tools/blur.ts

## Notes for clarification
- Pixelate vs gaussian: pixelate at a coarse block size is harder to reverse than a light blur.
- MCP at run: none.
