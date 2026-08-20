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
  // F299 (AS-570): true only while the CURRENT `draft` was started by the
  // keyboard-placement flow below (Enter on the focused canvas), never by
  // a pointer drag — so arrow-key adjustment can never hijack an
  // in-progress pointer drag, and a pointer drag can never be finished by
  // an accidental keypress meant for something else.
  const [keyboardDraftActive, setKeyboardDraftActive] = useState(false);

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
    setKeyboardDraftActive(false);
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

  // F299 (AS-570): commits whatever shape draft (arrow/rectangle/blur) is
  // currently in progress — shared by both the pointer-up handler above and
  // the keyboard-confirm handler below, so a keyboard-placed shape is
  // committed through the exact same code path (and therefore has exactly
  // the same real effect on `ops`) as a mouse-dragged one.
  function commitShapeDraft(current: Draft) {
    if (current.kind === "freehand") return;
    const moved = current.from.x !== current.to.x || current.from.y !== current.to.y;
    if (!moved) return;
    if (current.kind === "blur") {
      commitOp({ id: newOpId(), kind: "blur", from: current.from, to: current.to, blockSize: BLUR_BLOCK_SIZE });
    } else {
      commitOp({ id: newOpId(), kind: current.kind, from: current.from, to: current.to, color, strokeWidth });
    }
  }

  // F299 (AS-570): a real, coherent keyboard-only path for the drag-based
  // shape tools (arrow/rectangle/blur — blur's region-select reuses the
  // exact same from/to draft the rectangle tool uses). There is no natural
  // keyboard equivalent for a continuous pointer gesture, so this is NOT a
  // literal keyboard replay of a mouse drag: it's the same "place at a
  // default position, then adjust, then confirm" pattern real accessible
  // diagram/drawing tools use (arrow keys nudge a selected shape). Freehand
  // has no keyboard path here — see this file's Props comment and the
  // "Pen" tool button (data-testid annotate-tool-freehand), which has no
  // keyboard-placement handler at all; this is a disclosed, genuine
  // limitation (see the F299 handoff), not something silently claimed.
  //
  // Enter/Space with no draft in progress: place a shape of a fixed
  // default size at the canvas centre.
  // Arrow keys while a keyboard-placed draft is in progress: move the
  // whole shape. Shift+Arrow: resize (moves only the second corner).
  // Enter again: confirm/commit. Escape: cancel without committing.
  function handleCanvasKeyDown(e: ReactKeyboardEvent<HTMLCanvasElement>) {
    if (tool === "text" || tool === "freehand" || !naturalSize) return;

    if (!draft) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const cx = naturalSize.width / 2;
        const cy = naturalSize.height / 2;
        const halfW = Math.min(80, naturalSize.width / 4);
        const halfH = Math.min(50, naturalSize.height / 4);
        setDraft({
          kind: tool,
          from: { x: cx - halfW, y: cy - halfH },
          to: { x: cx + halfW, y: cy + halfH },
        });
        setKeyboardDraftActive(true);
      }
      return;
    }

    // A pointer drag is currently in progress — never let a stray keypress
    // interfere with it.
    if (!keyboardDraftActive || draft.kind === "freehand") return;

    if (e.key === "Enter") {
      e.preventDefault();
      commitShapeDraft(draft);
      setDraft(null);
      setKeyboardDraftActive(false);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setDraft(null);
      setKeyboardDraftActive(false);
      return;
    }

    const step = 8;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();

    if (e.shiftKey) {
      // Resize: move only the second corner.
      setDraft({ ...draft, to: { x: draft.to.x + dx, y: draft.to.y + dy } });
    } else {
      // Move: translate the whole shape.
      setDraft({
        ...draft,
        from: { x: draft.from.x + dx, y: draft.from.y + dy },
        to: { x: draft.to.x + dx, y: draft.to.y + dy },
      });
    }
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
          disabled={!naturalSize}
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
          tabIndex={0}
          role="application"
          aria-label={
            tool === "freehand"
              ? "Annotation canvas. The freehand pen tool requires a mouse or touch drag and has no keyboard equivalent — choose another tool to draw with the keyboard."
              : tool === "text"
                ? "Annotation canvas. Use the Add text button to place text with the keyboard."
                : `Annotation canvas, ${tool} tool selected. Press Enter to place a ${tool} shape at the centre, then use arrow keys to move it, Shift plus arrow keys to resize it, Enter to confirm, or Escape to cancel.`
          }
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
          onKeyDown={handleCanvasKeyDown}
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
