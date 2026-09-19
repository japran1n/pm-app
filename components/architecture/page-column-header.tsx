"use client";

// Mission 20260910-182104, F014 (AS-006, AS-033, AS-039): the inline
// rename affordance for a page column's header. A page IS a task
// (standing decision 1), so renaming it updates the same `title` column
// the task list view reads (AS-006 falls out for free -- no separate
// display name to keep in sync).
//
// Click or double-click the page name to enter edit mode (AS-033):
// - Enter saves via `renamePage` (lib/actions/architecture.ts) and
//   refreshes the route so the task list view picks up the new title.
// - Escape cancels and reverts to the last saved name, discarding the
//   in-progress edit.
// - An empty (post-trim) name is rejected client-side before the action
//   is even called, with a subtle inline error, and `renamePage` itself
//   also rejects empty names server-side (AS-039, defense in depth).
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText } from "lucide-react";

import { renamePage } from "@/lib/actions/architecture";
import { Input } from "@/components/ui/input";
import type { BoardPage } from "@/lib/queries/architecture";
import type { EstimateRollup, NodeMeta } from "@/lib/architecture/types";
import { NodeMetaDialog } from "@/components/architecture/node-meta-dialog";

// Mission 20260918-architecture-enrichment, F18 (AS estimate rollup
// display): formats a minute count as compact hours/minutes text for the
// rollup badge below the page title. Matches estimate-chip.tsx's own
// formatting so the same number reads identically in both places.
function formatMinutes(m: number): string {
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}

export function PageColumnHeader({
  page,
  showDetails,
  rollup,
  meta,
}: {
  page: BoardPage;
  showDetails?: boolean;
  rollup?: EstimateRollup;
  meta?: NodeMeta | null;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [value, setValue] = useState(page.title);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    setValue(page.title);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setValue(page.title);
    setError(null);
    setIsEditing(false);
  }

  function save() {
    const trimmed = value.trim();

    // AS-039: a page cannot be saved with an empty name -- reject before
    // ever calling the server action.
    if (!trimmed) {
      setError("Page name is required.");
      return;
    }

    if (trimmed === page.title) {
      setIsEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await renamePage(page.id, trimmed);

      if (result.success) {
        setIsEditing(false);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
        toast.error(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function handleKeyDown(keyEvent: React.KeyboardEvent<HTMLInputElement>) {
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      save();
    } else if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      cancelEditing();
    }
  }

  if (isEditing) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Input
          ref={inputRef}
          autoFocus
          disabled={isPending}
          value={value}
          onChange={(changeEvent) => {
            setValue(changeEvent.target.value);
            if (error) setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={save}
          aria-label="Page name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "page-name-rename-error" : undefined}
          className="h-7 text-sm"
        />
        {error && (
          <p id="page-name-rename-error" role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
    {showDetails && (
      <NodeMetaDialog
        taskId={page.id}
        taskTitle={page.title}
        meta={meta ?? null}
        open={metaOpen}
        onOpenChange={setMetaOpen}
      />
    )}
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-1">
        <p
          role="button"
          tabIndex={0}
          onClick={startEditing}
          onDoubleClick={startEditing}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === "Enter" || keyEvent.key === " ") {
              keyEvent.preventDefault();
              startEditing();
            }
          }}
          className="min-w-0 cursor-text truncate rounded-sm text-sm font-medium hover:bg-muted/50"
        >
          {page.title}
        </p>
        {showDetails && (
          <button
            type="button"
            aria-label="Edit page brief"
            onClick={() => setMetaOpen(true)}
            className="shrink-0 rounded-sm p-0.5 text-muted-foreground/50 hover:text-muted-foreground"
          >
            <FileText size={12} aria-hidden="true" />
          </button>
        )}
      </div>
      {showDetails && rollup && rollup.source !== "none" && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {rollup.source === "rolled" && "Σ "}
            {formatMinutes(rollup.total)}
          </span>
          {rollup.source === "rolled" && page.sections.length > 0 && (
            <span className="text-xs text-muted-foreground/60">
              ({page.sections.length} sections)
            </span>
          )}
          {rollup.conflicts && (
            <span
              className="text-xs text-muted-foreground/60"
              title={`Sections total: ${formatMinutes(rollup.sectionsTotal)}`}
            >
              · sections {formatMinutes(rollup.sectionsTotal)}
            </span>
          )}
        </div>
      )}
    </div>
    </>
  );
}
