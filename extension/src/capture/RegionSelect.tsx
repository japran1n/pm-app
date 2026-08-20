import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { CapturedScreenshot } from "./store";
import { cropDataUrlToRegion, cssRectToPhysicalRect, normalizeRect } from "./crop";
import type { CropResult } from "./crop";

// F284 — AS-540: let the user select a region of the already-captured
// full-tab screenshot to crop, instead of always keeping the whole visible
// area. See crop.ts's file header for why this renders over the *static
// captured image* in the popup rather than injecting a live-page overlay.

type Point = { x: number; y: number };

type Props = {
  capture: CapturedScreenshot;
  onCropped: (result: CropResult) => void;
  onCancel: () => void;
};

export function RegionSelect({ capture, onCropped, onCancel }: Props) {
  // Rendering the preview at CSS-pixel size = physical-pixel size /
  // devicePixelRatio shows it "true to page size" (matching how the page
  // looked before capture), which is what makes multiplying a CSS-pixel
  // drag rect by devicePixelRatio land exactly on the physical-pixel PNG —
  // see crop.ts.
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const displayWidth = naturalSize ? naturalSize.width / capture.devicePixelRatio : undefined;
  const displayHeight = naturalSize ? naturalSize.height / capture.devicePixelRatio : undefined;

  const containerRef = useRef<HTMLDivElement>(null);
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [dragCurrent, setDragCurrent] = useState<Point | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selection = dragStart && dragCurrent ? normalizeRect(dragStart, dragCurrent) : null;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // AS-540 / spec: Escape cancels the whole selection flow — back to
        // "no selection" (the full capture, unselected), never a stray
        // half-drawn overlay and never a crash.
        setDragStart(null);
        setDragCurrent(null);
        setError(null);
        onCancel();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  function pointFromEvent(e: ReactMouseEvent): Point | null {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !displayWidth || !displayHeight) return null;
    const x = Math.max(0, Math.min(e.clientX - rect.left, displayWidth));
    const y = Math.max(0, Math.min(e.clientY - rect.top, displayHeight));
    return { x, y };
  }

  function handleMouseDown(e: ReactMouseEvent) {
    const point = pointFromEvent(e);
    if (!point) return;
    setDragStart(point);
    setDragCurrent(point);
    setError(null);
  }

  function handleMouseMove(e: ReactMouseEvent) {
    if (!dragStart) return;
    const point = pointFromEvent(e);
    if (!point) return;
    setDragCurrent(point);
  }

  function handleMouseUp() {
    // Leave the finished rect visible for the readout / confirm step; a
    // fresh drag (mousedown) will overwrite it.
  }

  async function handleConfirmCrop() {
    if (!selection || selection.width <= 0 || selection.height <= 0) return;
    try {
      const physicalRect = cssRectToPhysicalRect(selection, capture.devicePixelRatio);
      const result = await cropDataUrlToRegion(capture.dataUrl, physicalRect);
      onCropped(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not crop the selected region.");
    }
  }

  return (
    <div data-testid="region-select-overlay">
      <div
        ref={containerRef}
        style={{
          position: "relative",
          display: "inline-block",
          maxWidth: "100%",
          overflow: "auto",
          userSelect: "none",
          cursor: "crosshair",
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        <img
          data-testid="region-select-image"
          src={capture.dataUrl}
          alt="Captured screenshot, drag to select a region to crop"
          style={{ display: "block", width: displayWidth, height: displayHeight }}
          onLoad={(e) => {
            const el = e.currentTarget;
            setNaturalSize({ width: el.naturalWidth, height: el.naturalHeight });
          }}
          draggable={false}
        />

        {/* Dimmed backdrop with a "cutout" over the selection, via the
            box-shadow spread trick: a giant shadow around the selection
            rect itself dims everything outside it without a second
            full-size overlay element that would otherwise sit on top of
            (and block dragging) the selection rect. */}
        {selection && (
          <div
            data-testid="region-select-rect"
            style={{
              position: "absolute",
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.45)",
              border: "1px solid #fff",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <p data-testid="region-select-readout" style={{ margin: "8px 0", fontSize: 13, color: "#333" }}>
        {selection
          ? `${Math.round(selection.width)} x ${Math.round(selection.height)} px`
          : "Drag on the screenshot to select a region."}
      </p>

      {error && (
        <p data-testid="region-select-error" style={{ margin: "0 0 8px", fontSize: 13, color: "#b91c1c" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button
          data-testid="region-crop-confirm-button"
          type="button"
          disabled={!selection || selection.width <= 0 || selection.height <= 0}
          onClick={handleConfirmCrop}
        >
          Crop to selection
        </button>
        <button data-testid="region-select-cancel-button" type="button" onClick={onCancel}>
          Use full screenshot
        </button>
      </div>
    </div>
  );
}
