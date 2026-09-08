"use client";

// F258 (AS-501, AS-502, AS-503): drag-and-drop file upload wrapping the
// task detail sheet.
//
// Native HTML5 drag events, deliberately NOT @dnd-kit — this codebase
// reserves @dnd-kit for sortable lists (board columns, checklist items),
// and dropping arbitrary OS files onto a target is a plain
// dragenter/dragover/dragleave/drop concern @dnd-kit doesn't model at all
// (per the feature spec's own "Draft scope").
//
// dragenter/dragleave counting: the browser fires dragenter/dragleave on
// every element the pointer crosses, including this dropzone's own
// descendants (labels, buttons, the comment editor, etc). Naively toggling
// highlight state on enter/leave flickers off every time the pointer
// crosses a child boundary while still over the dropzone. A depth counter
// (incremented on dragenter, decremented on dragleave) is the standard fix:
// highlight state only turns off when the counter returns to 0, i.e. the
// pointer has actually left the dropzone's outer boundary, not just
// crossed into a child.
//
// Window-level guard (this component's other job): if the user's drop
// misses the dropzone's own boundary — drops on a scrollbar, a sheet
// backdrop, whitespace outside the sheet, etc — the browser's default
// action for a dropped file is to navigate the tab to that file
// (`file://...`), which would blow away the whole app's state. Preventing
// default on window-level dragover AND drop (not just inside the
// dropzone's own handlers) closes that hole regardless of where exactly
// the drop lands.
import { useEffect, useRef, useState } from "react";

export function AttachmentDropzone({
  onFilesDropped,
  disabled = false,
  children,
}: {
  /** Called with every File the user dropped, in drop order. */
  onFilesDropped: (files: File[]) => void;
  /** F128 (AS-216): viewers can't upload — dropping is a no-op, same as
   * the picker button being disabled, rather than silently accepting the
   * drop and failing server-side with no visible feedback. */
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragDepth = useRef(0);

  // Window-level guard: prevents a stray drop anywhere in the document
  // (not just this dropzone) from navigating the browser tab to the
  // dropped file. Registered once for the lifetime of the mounted sheet,
  // not per-render.
  useEffect(() => {
    function preventNavigation(dragEvent: DragEvent) {
      dragEvent.preventDefault();
    }

    window.addEventListener("dragover", preventNavigation);
    window.addEventListener("drop", preventNavigation);

    return () => {
      window.removeEventListener("dragover", preventNavigation);
      window.removeEventListener("drop", preventNavigation);
    };
  }, []);

  function handleDragEnter(dragEvent: React.DragEvent<HTMLDivElement>) {
    if (disabled) return;
    // Only react to a real file being dragged, not e.g. dragging selected
    // text or an internal element (dnd-kit sortables elsewhere in the app
    // don't use native drag events, but this guard keeps the highlight
    // from firing on unrelated native drags too).
    if (!dragEvent.dataTransfer?.types.includes("Files")) return;

    dragEvent.preventDefault();
    dragDepth.current += 1;
    setIsDraggingOver(true);
  }

  function handleDragOver(dragEvent: React.DragEvent<HTMLDivElement>) {
    if (disabled) return;
    if (!dragEvent.dataTransfer?.types.includes("Files")) return;
    // Required so this element becomes a valid drop target at all — the
    // browser's default dragover action is "disallow drop".
    dragEvent.preventDefault();
  }

  function handleDragLeave(dragEvent: React.DragEvent<HTMLDivElement>) {
    if (disabled) return;
    if (!dragEvent.dataTransfer?.types.includes("Files")) return;

    dragEvent.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDraggingOver(false);
    }
  }

  function handleDrop(dragEvent: React.DragEvent<HTMLDivElement>) {
    dragEvent.preventDefault();
    dragDepth.current = 0;
    setIsDraggingOver(false);

    if (disabled) return;

    const files = Array.from(dragEvent.dataTransfer?.files ?? []);
    if (files.length > 0) {
      onFilesDropped(files);
    }
  }

  return (
    // `contents`: this wrapper exists purely to attach drag listeners
    // around the task detail sheet's header/body/footer — it must not
    // generate its own flex box, or it would break SheetContent's
    // `flex flex-col` height distribution (the scrollable body div relies
    // on being a *direct* flex child to shrink-to-fit; see the comment on
    // SheetContent's usage in task-detail-sheet.tsx). The highlight
    // overlay below still positions correctly because `absolute` climbs
    // past a `display: contents` ancestor to the next real positioned
    // box, which is SheetContent itself (`fixed`) — so the highlight
    // still covers the whole sheet, not a broken 0×0 box.
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="contents"
    >
      {children}

      {/* AS-502: visible highlight while a file is dragged over the
          target. Pointer-events-none so it never intercepts the drag
          events it's reacting to (dragleave firing on the overlay itself
          would fight the depth counter above). */}
      {isDraggingOver && !disabled && (
        <div
          data-testid="attachment-dropzone-highlight"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5"
        >
          <p className="rounded-md bg-background px-3 py-1.5 text-mini font-medium text-primary">
            Drop files to attach
          </p>
        </div>
      )}
    </div>
  );
}
