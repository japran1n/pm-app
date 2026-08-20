// F285 — AS-542, AS-543, AS-545: shared types for the annotation editor.
//
// All coordinates are in the *base image's own pixel space* (the same
// physical-pixel space the captured/cropped PNG already lives in), not CSS
// display pixels. The editor canvas's backing store is sized to the base
// image's natural pixel dimensions and pointer coordinates are mapped into
// that space on every event (see canvas.tsx's `pointToCanvasSpace`), so an
// annotation drawn at a given canvas pixel lands on the exact same pixel
// when the result is later flattened at full resolution — no separate
// "display scale" to reconcile at flatten time.
export type Point = { x: number; y: number };

export type ToolKind = "arrow" | "rectangle" | "freehand" | "text";

type BaseOp = {
  id: string;
  color: string;
  strokeWidth: number;
};

export type ArrowOp = BaseOp & {
  kind: "arrow";
  from: Point;
  to: Point;
};

export type RectangleOp = BaseOp & {
  kind: "rectangle";
  from: Point;
  to: Point;
};

export type FreehandOp = BaseOp & {
  kind: "freehand";
  points: Point[];
};

export type TextOp = BaseOp & {
  kind: "text";
  position: Point;
  text: string;
  fontSize: number;
};

// A single discrete, undoable annotation operation. Freehand strokes are
// committed as ONE operation per pointerdown-to-pointerup stroke (all the
// intermediate points bundled into `points`), not one operation per
// pointermove sample — so undo removes a whole stroke at once, matching
// the spec's "undo as one whole stroke, not point-by-point" guidance. See
// the handoff "Decisions made" for the reasoning.
export type AnnotationOp = ArrowOp | RectangleOp | FreehandOp | TextOp;

export type FlattenResult = {
  dataUrl: string;
  width: number;
  height: number;
};
