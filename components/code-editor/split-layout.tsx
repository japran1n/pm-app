"use client";

// F070 (TH-234, TH-235) — Resizable split layout between FileList+Editor
// (left) and Preview (right).
//
// A drag handle div with mouse event handling controls a left-pane percent
// width. The ratio is persisted in localStorage under 'ce-split-v1' so it
// survives reloads, matching the pattern used by `lib/code-editor/versions.ts`
// (every localStorage access wrapped in try/catch — quota errors or an
// unavailable store, e.g. private browsing/SSR, must never throw).
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "ce-split-v1";
const DEFAULT_SPLIT = 50;
const MIN_SPLIT = 20;
const MAX_SPLIT = 80;

function readSplit(): number {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_SPLIT;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SPLIT;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return DEFAULT_SPLIT;
    return clamp(parsed);
  } catch {
    return DEFAULT_SPLIT;
  }
}

function writeSplit(value: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable or quota exceeded — silently no-op.
  }
}

function clamp(value: number): number {
  return Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, value));
}

export interface SplitLayoutProps {
  left: React.ReactNode;
  right: React.ReactNode;
  className?: string;
}

/** Simple resizable two-pane layout with a persisted split ratio. */
export function SplitLayout({ left, right, className }: SplitLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // Lazy initializer (not an effect) so the persisted split is applied on
  // the very first render instead of causing a synchronous post-mount
  // re-render.
  const [split, setSplit] = useState<number>(() => readSplit());

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0) return;
    const pct = ((event.clientX - rect.left) / rect.width) * 100;
    const next = clamp(pct);
    setSplit(next);
  }, []);

  const stopDraggingRef = useRef<() => void>(() => {});
  const stopDragging = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setSplit((current) => {
      writeSplit(current);
      return current;
    });
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", stopDraggingRef.current);
  }, [handleMouseMove]);
  useEffect(() => {
    stopDraggingRef.current = stopDragging;
  }, [stopDragging]);

  const startDragging = useCallback(() => {
    draggingRef.current = true;
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopDragging);
  }, [handleMouseMove, stopDragging]);

  useEffect(() => {
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopDragging);
    };
  }, [handleMouseMove, stopDragging]);

  return (
    <div ref={containerRef} className={className ?? "flex h-full w-full"}>
      <div className="h-full min-w-0 overflow-hidden" style={{ width: `${split}%` }}>
        {left}
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- `separator` is the correct ARIA role for a resize handle (not `slider`, since this isn't a value-input control); mouse-drag is the only interaction implemented (TH-234/TH-235 scope), tracked as a follow-up to add arrow-key resizing. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize panels"
        onMouseDown={startDragging}
        className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-border-control-hover"
      />
      <div className="h-full min-w-0 flex-1 overflow-hidden">{right}</div>
    </div>
  );
}
