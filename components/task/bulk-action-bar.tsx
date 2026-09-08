// F185 (AS-336): floating action bar shown whenever the list view's
// selection (task-list-table.tsx's row-checkbox state) is non-empty.
// Renders the selected count and a "clear selection" control. The actual
// bulk actions (F186/F187 — e.g. bulk status change, bulk delete) are NOT
// implemented here; this is deliberately just the count + clear affordance
// plus a `children` slot future features can render their action buttons
// into, so F186/F187 don't need to re-build the floating bar shell.

"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";

export function BulkActionBar({
  selectedCount,
  onClear,
  children,
}: {
  /** Number of currently selected rows — 0 means the bar isn't rendered
   * (callers should not render this component at all when the selection
   * is empty; kept as an explicit prop rather than internal state so this
   * component has no opinion on where selection state lives). */
  selectedCount: number;
  /** F185/AS-342: clears the caller's selection state. Bulk actions added
   * by F186/F187 are expected to call this same handler once their
   * mutation completes, so the selection resets after an action fires —
   * this component only exposes the mechanism, it doesn't call it itself
   * on any action since no bulk action exists yet in this feature. */
  onClear: () => void;
  /** Slot for F186/F187's actual bulk-action buttons (status change,
   * delete, etc.) — empty in this feature. */
  children?: ReactNode;
}) {
  if (selectedCount === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4"
    >
      <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-2.5 shadow-lg">
        <span className="text-mini font-medium">
          {selectedCount} {selectedCount === 1 ? "task" : "tasks"} selected
        </span>
        {children}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClear}
          className="gap-1.5"
        >
          <X className="size-3.5" aria-hidden="true" />
          Clear selection
        </Button>
      </div>
    </div>
  );
}
