import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { drawAllOperations, fontSizeForStrokeWidth } from "./tools/draw";
import { BLUR_BLOCK_SIZE } from "./tools/blur";
import { flattenToPng } from "./flatten";
import type { AnnotationOp, FlattenResult, Point, ToolKind } from "./types";

// F285 — AS-542 (arrow/rectangle/freehand/text tools), AS-543 (undo/redo),
// AS-545 (the flattened-with-annotations PNG, not the pristine original,
// is what's handed onward).
//
// Coordinate space: the canvas's *backing store* (`canvas.width` /
// `canvas.height`) is sized to the base image's natural pixel dimensions;
// its CSS display size can be smaller (scaled down to fit the popup).
// Every pointer event is mapped from screen/CSS pixels into that backing
// store's pixel space before being recorded, so operations are always
// stored in the same pixel space the base image (and the eventual
// flattened PNG) live in — no separate rescale step needed at flatten
// time. This mirrors the devicePixelRatio-mapping pattern F284's
// RegionSelect established for the same reason (see crop.ts).
//
// Pointer Events API: pointerdown/pointermove/pointerup with
// `setPointerCapture` (https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture,
// verified 2026-08-20) — a single event model that covers mouse, touch,
// and pen, and per MDN's own recommendation supersedes separate
// mouse/touch handlers for exactly this kind of "drag to draw" surface.
//
// Undo/redo: a real stack of discrete operations. `ops` holds every
// committed operation currently applied; `redoStack` holds operations
// popped off by Undo, replayed by Redo, and cleared the moment a new
// operation is committed (the standard "redo history is invalidated by a
// new edit" behaviour). A freehand stroke is built up in `draftFreehand`
// during the drag and only pushed onto `ops` as ONE entry on pointerup —
// so Undo removes an entire stroke, not one sampled point at a time.
//
// Text tool keyboard operability: text entry never happens via a
// canvas-only click-to-type caret simulation (which only a mouse/pointer
// user could ever reach). Placing text always opens a real, focusable
// HTML <input> overlay — reachable either by clicking the canvas at the
// desired spot, or, for a keyboard-only user, via the "Add text" toolbar
// button (a normal <button>, reachable by Tab and activatable by
// Enter/Space) which opens the same input pre-positioned at the canvas
// centre. AS-570 (full keyboard-operability testing) is a later feature's
// job; this just avoids architecting the text tool in a way that makes
// that later work structurally impossible.
type Props = {
  baseImageDataUrl: string;
  onSubmit: (result: FlattenResult) => void;
  onCancel: () => void;
};

type Draft =
  | { kind: "arrow" | "rectangle" | "blur"; from: Point; to: Point }
  | { kind: "freehand"; points: Point[] };

type PendingText = {
  /** Position in canvas backing-store pixel space (where the text will be drawn). */
  canvasPoint: Point;
  /** Position in CSS pixels relative to the editor's positioning container
   * (where the HTML input overlay is placed on screen). */
  screenPoint: Point;
  value: string;
};

const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#111827", "#ffffff"];

let nextOpId = 0;
function newOpId(): string {
  nextOpId += 1;
  return `op-${nextOpId}-${Date.now()}`;
}

export function AnnotationEditor({ baseImageDataUrl, onSubmit, onCancel }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [tool, setTool] = useState<ToolKind>("arrow");
  const [color, setColor] = useState<string>(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState<number>(4);

  const [ops, setOps] = useState<AnnotationOp[]>([]);
  const [redoStack, setRedoStack] = useState<AnnotationOp[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pendingText, setPendingText] = useState<PendingText | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayWidth = naturalSize ? Math.min(naturalSize.width, 640) : undefined;
  const displayScale = naturalSize && displayWidth ? displayWidth / naturalSize.width : 1;
  const displayHeight = naturalSize ? naturalSize.height * displayScale : undefined;

  // Load the base image once to (a) discover its natural pixel size, so
  // the canvas backing store can be sized to match, and (b) keep a
  // reusable <img> handle for redraws (avoids re-decoding the data URL on
  // every render).
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.src = baseImageDataUrl;
    return () => {
      cancelled = true;
    };
  }, [baseImageDataUrl]);

  // Redraw: base image + every committed op + the in-progress draft (if
  // any), so what's on screen always matches what a flatten right now
  // would produce, plus a live preview of the current drag.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || !naturalSize) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, naturalSize.width, naturalSize.height);
    drawAllOperations(ctx, ops);

    if (draft) {
      const previewOp: AnnotationOp =
        draft.kind === "freehand"
          ? { id: "draft", kind: "freehand", points: draft.points, color, strokeWidth }
          : draft.kind === "blur"
            ? { id: "draft", kind: "blur", from: draft.from, to: draft.to, blockSize: BLUR_BLOCK_SIZE }
            : {
                id: "draft",
                kind: draft.kind,
                from: draft.from,
                to: draft.to,
                color,
                strokeWidth,
              };
      drawAllOperations(ctx, [previewOp]);
    }
  }, [ops, draft, naturalSize, color, strokeWidth]);

  function pointFromEvent(e: ReactPointerEvent<HTMLCanvasElement>): Point | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function screenPointFromEvent(e: ReactPointerEvent<HTMLCanvasElement>): Point {
    const containerRect = containerRef.current?.getBoundingClientRect();
    return {
      x: e.clientX - (containerRect?.left ?? 0),
      y: e.clientY - (containerRect?.top ?? 0),
    };
  }

  function commitOp(op: AnnotationOp) {
    setOps((prev) => [...prev, op]);
    setRedoStack([]);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(e);
    if (!point) return;

    if (tool === "text") {
      openTextInputAt(point, screenPointFromEvent(e));
      return;
    }

    canvasRef.current?.setPointerCapture(e.pointerId);
    if (tool === "freehand") {
      setDraft({ kind: "freehand", points: [point] });
    } else {
      setDraft({ kind: tool, from: point, to: point });
    }
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    const point = pointFromEvent(e);
    if (!point) return;
    if (draft.kind === "freehand") {
      setDraft({ kind: "freehand", points: [...draft.points, point] });
    } else {
      setDraft({ ...draft, to: point });
    }
  }

  function handlePointerUp(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!draft) return;
    canvasRef.current?.releasePointerCapture(e.pointerId);

    if (draft.kind === "freehand") {
      if (draft.points.length > 0) {
        commitOp({ id: newOpId(), kind: "freehand", points: draft.points, color, strokeWidth });
      }
    } else if (draft.kind === "blur") {
      const moved = draft.from.x !== draft.to.x || draft.from.y !== draft.to.y;
      if (moved) {
        commitOp({
          id: newOpId(),
          kind: "blur",
          from: draft.from,
          to: draft.to,
          blockSize: BLUR_BLOCK_SIZE,
        });
      }
    } else {
      const moved = draft.from.x !== draft.to.x || draft.from.y !== draft.to.y;
      if (moved) {
        commitOp({ id: newOpId(), kind: draft.kind, from: draft.from, to: draft.to, color, strokeWidth });
      }
    }
    setDraft(null);
  }

  function openTextInputAt(canvasPoint: Point, screenPoint: Point) {
    setPendingText({ canvasPoint, screenPoint, value: "" });
  }

  function handleAddTextKeyboard() {
    // Keyboard-reachable path: places the text input at the canvas centre
    // without requiring any pointer coordinate at all — satisfies "a
    // keyboard-only user can place and type text" (see file header).
    if (!naturalSize) return;
    const canvasPoint = { x: naturalSize.width / 2, y: naturalSize.height / 2 };
    const screenPoint = {
      x: (displayWidth ?? naturalSize.width) / 2,
      y: (displayHeight ?? naturalSize.height) / 2,
    };
    setTool("text");
    openTextInputAt(canvasPoint, screenPoint);
  }

  function commitPendingText() {
    if (!pendingText) return;
    const text = pendingText.value.trim();
    if (text.length > 0) {
      commitOp({
        id: newOpId(),
        kind: "text",
        position: pendingText.canvasPoint,
        text,
        color,
        strokeWidth,
        fontSize: fontSizeForStrokeWidth(strokeWidth),
      });
    }
    setPendingText(null);
  }

  function cancelPendingText() {
    setPendingText(null);
  }

  function handleTextInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitPendingText();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelPendingText();
    }
  }

  function handleUndo() {
    setOps((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((redo) => [...redo, last]);
      return prev.slice(0, -1);
    });
  }

  function handleRedo() {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setOps((current) => [...current, last]);
      return prev.slice(0, -1);
    });
  }

  const canUndo = ops.length > 0;
  const canRedo = redoStack.length > 0;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await flattenToPng(baseImageDataUrl, ops);
      onSubmit(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not flatten the annotated image.");
    } finally {
      setSubmitting(false);
    }
  }

  const tools = useMemo<{ kind: ToolKind; label: string }[]>(
    () => [
      { kind: "arrow", label: "Arrow" },
      { kind: "rectangle", label: "Rectangle" },
      { kind: "freehand", label: "Pen" },
      { kind: "text", label: "Text" },
      { kind: "blur", label: "Blur" },
    ],
    [],
  );

  return (
    <div data-testid="annotate-editor" ref={containerRef} style={{ position: "relative" }}>
      <div
        data-testid="annotate-toolbar"
        role="toolbar"
        aria-label="Annotation tools"
        style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}
      >
        {tools.map((t) => (
          <button
            key={t.kind}
            type="button"
            data-testid={`annotate-tool-${t.kind}`}
            aria-pressed={tool === t.kind}
            onClick={() => setTool(t.kind)}
            style={{
              fontWeight: tool === t.kind ? 700 : 400,
              outline: tool === t.kind ? "2px solid #2563eb" : undefined,
            }}
          >
            {t.label}
          </button>
        ))}

        <button
          type="button"
          data-testid="annotate-add-text-button"
          onClick={handleAddTextKeyboard}
          title="Add a text box (keyboard-reachable, places text at the centre)"
        >
          Add text
        </button>

        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Colour
          <input
            data-testid="annotate-color-picker"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          Width
          <input
            data-testid="annotate-stroke-width"
            type="range"
            min={1}
            max={20}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
          />
        </label>

        <button
          type="button"
          data-testid="annotate-undo"
          onClick={handleUndo}
          disabled={!canUndo}
        >
          Undo
        </button>
        <button
          type="button"
          data-testid="annotate-redo"
          onClick={handleRedo}
          disabled={!canRedo}
        >
          Redo
        </button>
      </div>

      <div style={{ position: "relative", display: "inline-block" }}>
        <canvas
          data-testid="annotate-canvas"
          ref={canvasRef}
          width={naturalSize?.width ?? 1}
          height={naturalSize?.height ?? 1}
          style={{
            width: displayWidth,
            height: displayHeight,
            display: "block",
            border: "1px solid #ddd",
            touchAction: "none",
            cursor: tool === "text" ? "text" : "crosshair",
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />

        {pendingText && (
          <input
            data-testid="annotate-text-input"
            autoFocus
            type="text"
            value={pendingText.value}
            onChange={(e) => setPendingText({ ...pendingText, value: e.target.value })}
            onKeyDown={handleTextInputKeyDown}
            onBlur={commitPendingText}
            style={{
              position: "absolute",
              left: pendingText.screenPoint.x,
              top: pendingText.screenPoint.y,
              font: `${fontSizeForStrokeWidth(strokeWidth) * displayScale}px sans-serif`,
              color,
              border: "1px dashed #2563eb",
              background: "rgba(255,255,255,0.9)",
              padding: "1px 3px",
              minWidth: 80,
            }}
          />
        )}
      </div>

      {error && (
        <p data-testid="annotate-error" style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button
          type="button"
          data-testid="annotate-confirm-button"
          onClick={handleSubmit}
          disabled={submitting || !naturalSize}
        >
          {submitting ? "Saving…" : "Save annotations"}
        </button>
        <button type="button" data-testid="annotate-cancel-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
