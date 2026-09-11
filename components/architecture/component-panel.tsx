"use client";

// Mission 20260910-182104, F034 (AS-081, AS-082, AS-083): a right-side
// panel listing every one of the project's components, each with its
// instance count. Instance counts (including zero) come straight through
// from `getArchitectureBoard` (lib/queries/architecture.ts), which already
// starts from the full component list and defaults the count to 0 rather
// than inferring components only from linked sections -- so this panel
// never needs to compute counts itself, it just renders what it's given.
//
// F035 (component detail / navigation) builds on top of this panel's
// `onSelectComponent` hook point.
//
// F036 (AS-087, AS-088): rename and delete affordances live in-panel next
// to each component. Rename mirrors the inline edit pattern from
// PageColumnHeader (components/architecture/page-column-header.tsx) --
// click the pencil to swap the name for an input, save on blur/Enter via
// `renameComponent`, cancel on Escape. Delete mirrors DeleteSectionButton
// (components/architecture/delete-section-button.tsx) -- a Dialog with an
// explicit destructive confirm button rather than a plain window.confirm,
// since this action is permanent, then `deleteComponent` +
// `router.refresh()`.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteComponent, renameComponent } from "@/lib/actions/architecture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";

function ComponentListItem({
  component,
  onSelectComponent,
}: {
  component: BoardComponent;
  onSelectComponent?: (component: BoardComponent) => void;
}) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(component.name);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isRenamePending, startRenameTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    setValue(component.name);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setValue(component.name);
    setError(null);
    setIsEditing(false);
  }

  function save() {
    const trimmed = value.trim();

    if (!trimmed) {
      setError("Component name is required.");
      return;
    }

    if (trimmed === component.name) {
      setIsEditing(false);
      return;
    }

    startRenameTransition(async () => {
      const result = await renameComponent(component.id, trimmed);

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

  function handleDelete() {
    startDeleteTransition(async () => {
      const result = await deleteComponent(component.id);

      if (!result.success) {
        const message = result.error ?? "Something went wrong.";
        toast.error(message);
        return;
      }

      setDeleteOpen(false);
      router.refresh();
    });
  }

  if (isEditing) {
    return (
      <li>
        <div className="flex flex-col gap-1 px-2 py-2">
          <Input
            ref={inputRef}
            autoFocus
            disabled={isRenamePending}
            value={value}
            onChange={(changeEvent) => {
              setValue(changeEvent.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            onBlur={save}
            aria-label="Component name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `component-rename-error-${component.id}` : undefined}
            className="h-7 text-sm"
          />
          {error && (
            <p
              id={`component-rename-error-${component.id}`}
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </div>
      </li>
    );
  }

  return (
    <li>
      <div className="flex w-full items-center justify-between gap-2 rounded-md border border-transparent px-2 py-2 text-sm hover:border-border-control-hover hover:bg-muted/50">
        <button
          type="button"
          onClick={() => onSelectComponent?.(component)}
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
        >
          <span className="truncate">{component.name}</span>
          <span className="shrink-0 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.07em] text-muted-foreground">
            {component.instanceCount}{" "}
            {component.instanceCount === 1 ? "instance" : "instances"}
          </span>
        </button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Rename ${component.name}`}
          className="shrink-0"
          onClick={startEditing}
        >
          <Pencil className="size-4" aria-hidden="true" />
        </Button>

        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Delete ${component.name}`}
                className="shrink-0"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this component?</DialogTitle>
              <DialogDescription>
                Delete {component.name}? This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose
                render={
                  <Button type="button" variant="ghost" disabled={isDeletePending}>
                    Cancel
                  </Button>
                }
              />
              <Button
                type="button"
                variant="destructive"
                disabled={isDeletePending}
                onClick={handleDelete}
              >
                {isDeletePending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Deleting...
                  </>
                ) : (
                  "Delete component"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </li>
  );
}

export function ComponentPanel({
  components,
  pages = [],
  onClose,
  onSelectComponent,
  onPageSelect,
  selectedComponentId,
}: {
  components: BoardComponent[];
  pages?: BoardPage[];
  onClose?: () => void;
  onSelectComponent?: (component: BoardComponent) => void;
  onPageSelect?: (pageId: string) => void;
  selectedComponentId?: string | null;
}) {
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);

  // Allow a parent (board.tsx) to drive selection externally -- e.g. when
  // a section card's component label is clicked (AS-084) -- while still
  // supporting purely-internal selection from clicking a component in
  // this panel's own list.
  const effectiveSelectedId = selectedComponentId ?? internalSelectedId;
  const selectedComponent = effectiveSelectedId
    ? components.find((component) => component.id === effectiveSelectedId) ?? null
    : null;

  function selectComponent(component: BoardComponent) {
    setInternalSelectedId(component.id);
    onSelectComponent?.(component);
  }

  function backToList() {
    setInternalSelectedId(null);
  }

  if (selectedComponent) {
    // AS-085: every page on which this component appears -- a page
    // qualifies if any of its sections links to this component.
    const pagesWithComponent = pages.filter((page) =>
      page.sections.some((section) => section.component?.id === selectedComponent.id),
    );

    return (
      <aside
        role="complementary"
        aria-label="Components"
        className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-border bg-card shadow-xs"
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={backToList}
              aria-label="Back to components list"
              className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover"
            >
              Back
            </button>
            <h2 className="truncate text-sm font-medium">{selectedComponent.name}</h2>
          </div>
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close components panel"
              className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover"
            >
              Close
            </button>
          ) : null}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="mb-2 font-mono text-[9px] uppercase tracking-[0.07em] text-muted-foreground">
            Appears on
          </h3>
          {pagesWithComponent.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">
              This component doesn&apos;t appear on any page.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {pagesWithComponent.map((page) => (
                <li key={page.id}>
                  <button
                    type="button"
                    onClick={() => onPageSelect?.(page.id)}
                    className="flex w-full items-center rounded-md border border-transparent px-2 py-2 text-left text-sm hover:border-border-control-hover hover:bg-muted/50"
                  >
                    {page.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label="Components"
      className="fixed right-0 top-0 z-40 flex h-full w-80 flex-col border-l border-border bg-card shadow-xs"
    >
      <div className="flex items-center justify-between border-b border-border p-4">
        <h2 className="text-sm font-medium">Components</h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close components panel"
            className="rounded-md border border-transparent px-2 py-1 text-xs text-muted-foreground hover:border-border-control-hover"
          >
            Close
          </button>
        ) : null}
      </div>

      <ul className="flex-1 overflow-y-auto p-2">
        {components.length === 0 ? (
          <li className="p-2 text-sm text-muted-foreground">No components yet.</li>
        ) : (
          components.map((component) => (
            <ComponentListItem
              key={component.id}
              component={component}
              onSelectComponent={selectComponent}
            />
          ))
        )}
      </ul>
    </aside>
  );
}
