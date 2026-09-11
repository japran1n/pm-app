"use client";

// Mission 20260910-182104, F008 (AS-025): a section card shows the
// section name. Also shows the linked component's name as secondary text
// when present -- the visual distinction (chip/border colour) between
// sections with and without a component lands in F027/F032; this card
// only needs to surface the plain text for now.
//
// `data-component` carries the linked component's id (or is omitted when
// there is none) so F033's board-wide hover-linking can select every
// section card sharing a component via `[data-component="<id>"]` once the
// board root sets `data-hover-component`.
//
// Mission 20260910-182104, F015 (AS-007, AS-034, AS-040): the section
// title is now inline-editable on the board, mirroring
// PageColumnHeader's rename affordance (components/architecture/
// page-column-header.tsx, F014) for a page. A section IS a subtask of
// its page task (standing decision 1), so renaming it updates the same
// `title` column the task list view reads elsewhere -- AS-007 falls out
// for free from sharing that one column, with no separate display name
// to keep in sync.
//
// Click the section title to enter edit mode (AS-034):
// - Enter saves via `renameSection` (lib/actions/architecture.ts) and
//   refreshes the route so the task list view picks up the new title.
// - Escape cancels and reverts to the last saved name, discarding the
//   in-progress edit.
// - An empty (post-trim) name is rejected client-side before the action
//   is even called, with a subtle inline error, and `renameSection`
//   itself also rejects empty names server-side (AS-040, defense in
//   depth).
import { useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Boxes } from "lucide-react";

import { renameSection, createComponentFromSection } from "@/lib/actions/architecture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BoardSection } from "@/lib/queries/architecture";
import { DeleteSectionButton } from "@/components/architecture/delete-section-button";

export function SectionCard({ section }: { section: BoardSection }) {
  const router = useRouter();
  // Same convention as AddSectionButton (F013): the board route is scoped
  // to a single project, so the project id is read from the route params
  // rather than threaded as a prop through ArchitectureBoard -> PageColumn
  // -> SortableSectionList -> SortableSectionCard -- avoids widening every
  // intermediate component's public contract just for this one action's
  // second argument.
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(section.title);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isCreatingComponent, startCreatingComponent] = useTransition();

  function handleCreateComponent() {
    startCreatingComponent(async () => {
      const result = await createComponentFromSection(section.id, projectId);

      if (result.success) {
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function startEditing() {
    setValue(section.title);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setValue(section.title);
    setError(null);
    setIsEditing(false);
  }

  function save() {
    const trimmed = value.trim();

    // AS-040: a section cannot be saved with an empty name -- reject
    // before ever calling the server action.
    if (!trimmed) {
      setError("Section name is required.");
      return;
    }

    if (trimmed === section.title) {
      setIsEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await renameSection(section.id, trimmed);

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
    <div
      data-component={section.component?.id ?? undefined}
      className="group relative w-full rounded-md border bg-card p-3 shadow-xs transition-colors hover:border-border-control-hover"
    >
      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {section.component === null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Create component"
            title="Create component"
            className="shrink-0"
            disabled={isCreatingComponent}
            onClick={handleCreateComponent}
          >
            <Boxes className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
        <DeleteSectionButton
          sectionId={section.id}
          sectionTitle={section.title}
        />
      </div>
      {isEditing ? (
        <div className="flex min-w-0 flex-col gap-1">
          <Input
            autoFocus
            disabled={isPending}
            value={value}
            onChange={(changeEvent) => {
              setValue(changeEvent.target.value);
              if (error) setError(null);
            }}
            onKeyDown={handleKeyDown}
            onBlur={save}
            aria-label="Section name"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "section-name-rename-error" : undefined}
            className="h-7 text-sm"
          />
          {error && (
            <p
              id="section-name-rename-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </div>
      ) : (
        <p
          role="button"
          tabIndex={0}
          onClick={startEditing}
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === "Enter" || keyEvent.key === " ") {
              keyEvent.preventDefault();
              startEditing();
            }
          }}
          className="truncate rounded-sm pr-6 text-sm font-medium hover:bg-muted/50"
        >
          {section.title}
        </p>
      )}
      {section.component ? (
        <p className="truncate text-xs text-muted-foreground">
          {section.component.name}
        </p>
      ) : null}
    </div>
  );
}
