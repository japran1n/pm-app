// F285 — AS-542: renders each annotation tool's operation onto a 2D canvas
// context. Pure functions, no React/DOM-event concerns, so they can be
// reused identically by the live interactive canvas (canvas.tsx) and by
// the final flatten step (flatten.ts) — the exact same drawing code
// produces the exact same pixels in both places, which is what makes
// AS-545's "the flattened PNG is what the user actually saw" claim true.
import type { AnnotationOp, ArrowOp, FreehandOp, Point, RectangleOp, TextOp } from "../types";

export function drawOperation(ctx: CanvasRenderingContext2D, op: AnnotationOp): void {
  ctx.save();
  ctx.strokeStyle = op.color;
  ctx.fillStyle = op.color;
  ctx.lineWidth = op.strokeWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (op.kind) {
    case "arrow":
      drawArrow(ctx, op);
      break;
    case "rectangle":
      drawRectangle(ctx, op);
      break;
    case "freehand":
      drawFreehand(ctx, op);
      break;
    case "text":
      drawText(ctx, op);
      break;
  }

  ctx.restore();
}

export function drawAllOperations(ctx: CanvasRenderingContext2D, ops: readonly AnnotationOp[]): void {
  for (const op of ops) {
    drawOperation(ctx, op);
  }
}

function drawArrow(ctx: CanvasRenderingContext2D, op: ArrowOp): void {
  const { from, to } = op;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();

  // Arrowhead: two short lines back from the tip, angled off the shaft.
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const headLength = Math.max(10, op.strokeWidth * 4);
  const headAngle = Math.PI / 7;

  ctx.beginPath();
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLength * Math.cos(angle - headAngle),
    to.y - headLength * Math.sin(angle - headAngle),
  );
  ctx.moveTo(to.x, to.y);
  ctx.lineTo(
    to.x - headLength * Math.cos(angle + headAngle),
    to.y - headLength * Math.sin(angle + headAngle),
  );
  ctx.stroke();
}

function drawRectangle(ctx: CanvasRenderingContext2D, op: RectangleOp): void {
  const x = Math.min(op.from.x, op.to.x);
  const y = Math.min(op.from.y, op.to.y);
  const width = Math.abs(op.to.x - op.from.x);
  const height = Math.abs(op.to.y - op.from.y);
  ctx.strokeRect(x, y, width, height);
}

function drawFreehand(ctx: CanvasRenderingContext2D, op: FreehandOp): void {
  if (op.points.length === 0) return;
  if (op.points.length === 1) {
    // A single-point "stroke" (click without drag) still renders as a dot,
    // so it's never silently invisible.
    const p = op.points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, op.strokeWidth / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(op.points[0].x, op.points[0].y);
  for (const point of op.points.slice(1)) {
    ctx.lineTo(point.x, point.y);
  }
  ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, op: TextOp): void {
  if (!op.text) return;
  ctx.font = `${op.fontSize}px sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(op.text, op.position.x, op.position.y);
}

/** Font size derived from the shared stroke-width control, so the text
 * tool doesn't need a second, redundant "size" control. */
export function fontSizeForStrokeWidth(strokeWidth: number): number {
  return 12 + strokeWidth * 4;
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
