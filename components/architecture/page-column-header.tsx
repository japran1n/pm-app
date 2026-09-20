"use client";

// Mission 20260910-182104, F014 (AS-006, AS-033, AS-039): the page card
// header -- the ONE header both the column board (page-column.tsx) and the
// canvas (canvas-board.tsx) render, so the two views are identical by
// construction rather than by two call sites staying in sync by hand. The
// column board's drag grip is board-specific and is passed in through the
// `grip` slot; everything else (title + inline rename, estimate chip,
// copy-brief affordance, overflow menu) is shared.
//
// The body holds only what a reader scans: the page name, its estimate,
// and the copy-brief affordance. Destructive and rarely-used controls
// (page kind, client visibility, delete) live in PageCardMenu.
//
// The inline rename affordance: A page IS a task
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

import { useArchitectureActions } from "@/lib/architecture/actions-context";
import { Input } from "@/components/ui/input";
import type { BoardPage } from "@/lib/queries/architecture";
import type { DisciplineEstimate, NodeMeta } from "@/lib/architecture/types";

// F094 (mirrors section-card.tsx's hasNodeMetaContent): the page-level
// copy-brief affordance's aria-label must say "Add" when there is nothing
// to edit yet, not "Edit" -- same rule as the section card icon.
function hasNodeMetaContent(meta: NodeMeta | null | undefined): boolean {
  if (!meta) return false;
  return Boolean(
    meta.intent ||
      meta.audience ||
      meta.primaryCta ||
      meta.tone ||
      meta.keywords.length > 0,
  );
}
import { NodeMetaDialog } from "@/components/architecture/node-meta-dialog";
import { EstimateChip } from "@/components/architecture/estimate-chip";
import { PageCardMenu } from "@/components/architecture/page-card-menu";

export function PageColumnHeader({
  page,
  showDetails,
  meta,
  estimates,
  detailsLoading,
  onDetailsInvalidate,
  grip,
}: {
  page: BoardPage;
  showDetails?: boolean;
  meta?: NodeMeta | null;
  estimates?: DisciplineEstimate[];
  /** F084: true while `showDetails` is on but the lazily-fetched details
   *  cache hasn't resolved yet (or was just invalidated). `estimates` is
   *  `[]` in that window too, so without this flag the chip looks like a
   *  confirmed "no estimate" state and Save would erase real data. */
  detailsLoading?: boolean;
  /** Called after an estimate or copy brief is saved, so the owner of the
   *  lazily-fetched details cache can drop it and refetch. */
  onDetailsInvalidate?: () => void;
  /** Board-only drag handle. The canvas passes nothing, which is the one
   *  difference between the two views' headers. */
  grip?: React.ReactNode;
}) {
  const {
    renamePage,
    changePageSlug,
    readOnly,
    estimates: estimatesCapability,
    nodeMeta,
  } = useArchitectureActions();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  const [value, setValue] = useState(page.title);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditingSlug, setIsEditingSlug] = useState(false);
  const [slugValue, setSlugValue] = useState("");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [isSlugPending, startSlugTransition] = useTransition();

  function saveSlug() {
    const trimmedSlug = slugValue.trim();

    // No-op guard: nothing changed (or reverted, e.g. after Escape resets
    // slugValue before the blur handler below fires) -- just close the
    // editor without calling the action.
    if (trimmedSlug === (page.pageSlug ?? "")) {
      setIsEditingSlug(false);
      setSlugError(null);
      return;
    }

    startSlugTransition(async () => {
      try {
        const result = await changePageSlug(page.id, trimmedSlug);
        if (!result.success) {
          setSlugError(result.error ?? "Failed to update slug.");
        } else {
          setIsEditingSlug(false);
          setSlugError(null);
          router.refresh();
        }
      } catch {
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  function cancelSlugEditing() {
    setSlugValue(page.pageSlug ?? "");
    setSlugError(null);
    setIsEditingSlug(false);
  }

  function handleSlugKeyDown(keyEvent: React.KeyboardEvent<HTMLInputElement>) {
    if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      cancelSlugEditing();
      return;
    }
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      saveSlug();
    }
  }

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

  return (
    <>
      {showDetails && nodeMeta && (
        <NodeMetaDialog
          taskId={page.id}
          taskTitle={page.title}
          meta={meta ?? null}
          open={metaOpen}
          onOpenChange={setMetaOpen}
          onSaved={onDetailsInvalidate}
        />
      )}
      <div className="flex items-start gap-1.5">
        {grip}
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex min-w-0 flex-col gap-1">
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
                <p
                  id="page-name-rename-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
          ) : readOnly ? (
            <p className="min-w-0 truncate text-sm font-medium">{page.title}</p>
          ) : (
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
          )}
          {readOnly ? (
            page.pageSlug != null && (
              <span className="text-xs text-muted-foreground font-mono truncate max-w-full block">
                /{page.pageSlug}
              </span>
            )
          ) : !isEditingSlug ? (
            page.pageSlug != null && (
              <button
                type="button"
                className="text-xs text-muted-foreground font-mono hover:text-foreground truncate max-w-full text-left"
                onClick={() => {
                  setSlugValue(page.pageSlug ?? "");
                  setIsEditingSlug(true);
                  setSlugError(null);
                }}
                aria-label={`Edit slug: ${page.pageSlug}`}
              >
                /{page.pageSlug}
              </button>
            )
          ) : (
            <div className="flex flex-col gap-0.5">
              <Input
                value={slugValue}
                disabled={isSlugPending}
                onChange={(changeEvent) => {
                  setSlugValue(changeEvent.target.value);
                  setSlugError(null);
                }}
                onKeyDown={handleSlugKeyDown}
                onBlur={saveSlug}
                aria-invalid={slugError != null}
                aria-describedby={slugError ? `slug-error-${page.id}` : undefined}
                className="h-6 text-xs font-mono"
                autoFocus
              />
              {slugError && (
                <p
                  id={`slug-error-${page.id}`}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {slugError}
                </p>
              )}
            </div>
          )}
          {showDetails && !isEditing && (estimatesCapability || nodeMeta) && (
            <div className="flex items-center gap-1 pt-1.5">
              {estimatesCapability && (
                <EstimateChip
                  taskId={page.id}
                  taskTitle={page.title}
                  estimates={estimates ?? []}
                  loading={detailsLoading}
                  onDetailsInvalidate={onDetailsInvalidate}
                />
              )}
              {nodeMeta && (
                <button
                  type="button"
                  aria-label={
                    hasNodeMetaContent(meta)
                      ? `Edit copy brief for ${page.title}`
                      : `Add copy brief for ${page.title}`
                  }
                  aria-haspopup="dialog"
                  title="Copy brief"
                  onClick={() => setMetaOpen(true)}
                  className="shrink-0 rounded-md border border-transparent p-1 text-muted-foreground transition-colors hover:border-border-control-hover hover:text-foreground"
                >
                  <FileText
                    className="size-3.5"
                    aria-hidden="true"
                    fill={hasNodeMetaContent(meta) ? "currentColor" : "none"}
                    data-node-meta-icon-state={
                      hasNodeMetaContent(meta) ? "full" : "empty"
                    }
                  />
                </button>
              )}
            </div>
          )}
        </div>
        <PageCardMenu page={page} />
      </div>
    </>
  );
}
