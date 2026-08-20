# Handoff: F286 — annotation blur tool

## Status
COMPLETE

## Assertions covered
AS-544: PASS — `extension/tests/annotate-blur.spec.ts` drives the real built popup UI (real pointer drag) to draw a high-contrast rectangle then blur over it, decodes the real PNG pixel bytes via `pngjs`, and proves (1) every `BLUR_BLOCK_SIZE`x`BLUR_BLOCK_SIZE` block inside the dragged region is pixel-uniform after blurring (genuine block-averaging, not "some pixels changed"), (2) the region's pixels measurably differ from the pre-blur pixels, (3) live-session Undo (while still in the editor, before export) restores the exact pre-blur pixel values, and (4) after clicking "Save annotations" and reading the exact same `annotated-preview` `<img>` src the F285 AS-545 test already reads (i.e. the byte-for-byte exported artifact), the blocks are still uniform there too and points that varied pre-blur are now identical post-blur in the exported bytes — proving the pixelation is baked into the flattened PNG itself, not a drawn shape sitting on top that could be peeled off.

## Files changed
extension/src/annotate/types.ts (added `BlurOp`, added `"blur"` to `ToolKind`/`AnnotationOp`)
extension/src/annotate/tools/blur.ts (new — `drawBlurRegion`, `BLUR_BLOCK_SIZE`)
extension/src/annotate/tools/draw.ts (added the `"blur"` branch to `drawOperation`, routing to `drawBlurRegion` and skipping the shared stroke/fill style setup that doesn't apply to it)
extension/src/annotate/canvas.tsx (added `"blur"` to the tool palette/toolbar, drag-select handling in `handlePointerDown`/`handlePointerMove`/`handlePointerUp`, and the live preview-draft rendering path)
extension/tests/annotate-blur.spec.ts (new)

## Commands run
`npx playwright test tests/annotate-blur.spec.ts` (extension/, 0 — 2/2 passed)
`npm run build` (extension/, 0 — includes check-no-secret-key.mjs AS-538 re-check on the fresh build, PASS)
`npx playwright test` (extension/, 0 — full suite, 24/24 passed, confirms F280-F285's existing tests plus F286's new tests all pass together against the fresh build)
`npx tsc --noEmit` (extension/, 0)
`npx eslint .` (extension/, 0)
`npx tsc --noEmit` (app root, 0)
`npx eslint .` (app root, 0 errors — 1 pre-existing unrelated warning in lib/queries/search.ts, same one F285 noted)

## Decisions made
- **Pixelation (coarse block-average), not gaussian/soft blur** — per the clarification's own resolution of the spec's open question and the standing "simpler, more private option" tie-breaker: a gaussian blur is a convolution and can sometimes be partially reversed via deconvolution, whereas coarse block-averaging genuinely discards information (every pixel in a block becomes indistinguishable from every other pixel in the same block — there is nothing left to invert once the average has overwritten the originals).
- **Block size: 16 base-image pixels per side** (`BLUR_BLOCK_SIZE` in `blur.ts`) — coarse enough to make small on-screen text (emails, tokens) fully illegible at typical browser screenshot resolution (a lowercase character is usually well under 16px wide/tall at normal zoom), while not so coarse that a small redacted region collapses into a single indistinguishable flat rectangle that could be mistaken for an opaque cover-up rather than a genuine pixelation (tests specifically check for *block*-uniformity, i.e. multiple distinct uniform blocks, not one giant uniform blob).
- **`BlurOp` deliberately does not extend the shared `BaseOp` (`color`/`strokeWidth`)** — a blur region is not a stroke-styled drawing primitive, it's a pixel-transform operation over a rectangular area; giving it fake/unused `color`/`strokeWidth` fields would be a type lie. `drawOperation` special-cases `kind === "blur"` before the shared stroke/fill style setup rather than trying to force it through that shared setup.
- **Genuine destructiveness via `getImageData`/`putImageData`, not a drawn shape** — `drawBlurRegion` reads the canvas's actual current raster pixel buffer for the target region (via `ctx.getImageData`), computes each block's average RGBA, and writes the averaged colour back into every pixel of that block (via `ctx.putImageData`). This is a genuine transform of the pixel buffer itself, not `ctx.fillRect`-style drawing on top of untouched pixels underneath — there is no "underneath" left once this runs; the original pixel values are gone from the buffer.
- **Reused F285's exact `ops`/`redoStack`/`drawAllOperations`/`flattenToPng` architecture rather than a parallel destructive-editing path**, per the feature instructions. This is what makes both halves of the requirement true simultaneously: (a) during live editing, Undo removes the last committed op (including a blur op) and the redraw effect recomputes strictly from the base image + the remaining `ops` in order — so a blurred region can still be un-blurred normally while editing, matching ordinary editing UX; (b) once the user clicks "Save annotations", `flattenToPng` replays the exact same `ops` list (via the exact same `drawAllOperations`/`drawOperation`/`drawBlurRegion` functions the live canvas used) onto a fresh canvas and exports its real raster bytes via `canvas.toDataURL` — so the exported PNG's blurred-region pixels are the actual block-averaged pixel values, not a vector shape re-rendered as "still editable" metadata. There is no separate non-destructive representation of a blur op that persists past export; once `ops` (including any blur ops) is baked into the exported canvas, the averaging is permanent in that PNG's bytes.
- **Order-dependent replay is intentional and consistent**: because both the live redraw effect and `flattenToPng` always start from `ctx.drawImage(baseImage,...)` and then replay every op in `ops` order via `drawAllOperations`, a blur op reads whatever pixels are already on the canvas at that point in the replay (base image plus every op committed *before* the blur op in the list) — so a blur op correctly captures earlier annotations already in that region and destroys them along with the base image content, and is itself excluded from the replay (and therefore reversible) by Undo removing it from `ops`, exactly like every other op kind.
- **Drag-select UX**: reused the same rectangle-style pointer-drag (`from`/`to` corners) as the existing rectangle tool, rather than inventing a new interaction pattern — a user selecting a region to redact is functionally the same gesture as drawing a rectangle, just with a different (destructive, pixel-transform) render function at the end.

## Out-of-scope work needed
- None identified beyond what F285's own handoff already flagged as out-of-scope for the annotation editor as a whole (moving/resizing committed ops after the fact, full keyboard-operability audit for AS-570) — this feature did not need to touch any of that, and the blur tool follows the same draw-once-and-undo/redo model as every other tool.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose 16px as the coarse block size (see "Decisions made" above) — the spec explicitly asked for a block size to be picked deliberately and documented, without dictating an exact number; 16px was chosen as a value that reliably destroys small text/token legibility (the clarification's core privacy goal) without collapsing a modest-sized redaction region into a single undifferentiated block, which the tests were also written to distinguish (checking multiple distinct uniform blocks, not one flat rectangle).

## Notes for the next worker
- `extension/src/annotate/tools/blur.ts` exports `BLUR_BLOCK_SIZE` and `drawBlurRegion`; both `draw.ts`'s `drawOperation` and (transitively, since it calls `drawAllOperations`) `flatten.ts`'s `flattenToPng` use it identically to F285's other tool functions — no divergent code path exists between the live canvas and the final export for the blur tool, same as F285 established for arrow/rectangle/freehand/text.
- The blur tool's toolbar button is `data-testid="annotate-tool-blur"`, following the exact same `annotate-tool-${kind}` convention F285 set for the other four tools — no new toolbar wiring pattern was introduced.
- Real APIs used, verified 2026-08-20 (same environment F285 already verified `CanvasRenderingContext2D` in): `CanvasRenderingContext2D.getImageData`/`putImageData` — stable, no version concerns, standard Canvas 2D API.
- MCP usage: none (pure client-side canvas/browser-API feature, no external service state to introspect, matching the feature spec's "MCP at run: none").
