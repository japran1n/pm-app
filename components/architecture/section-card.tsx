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
import { cn } from "@/lib/utils";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Boxes, Link2 } from "lucide-react";

import {
  renameSection,
  createComponentFromSection,
  unlinkComponentFromSection,
} from "@/lib/actions/architecture";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ComponentPicker } from "@/components/architecture/component-picker";
import type { BoardComponent, BoardSection } from "@/lib/queries/architecture";
import { DeleteSectionButton } from "@/components/architecture/delete-section-button";
import { SectionClientVisibilityToggle } from "@/components/architecture/section-client-visibility-toggle";
import { sectionKindAccentClassName } from "@/lib/architecture/section-tint";
import { EstimateChip } from "@/components/architecture/estimate-chip";
import type { DisciplineEstimate } from "@/lib/architecture/types";

export function SectionCard({
  section,
  components = [],
  onComponentClick,
  showDetails = false,
  estimates,
}: {
  section: BoardSection;
  components?: BoardComponent[];
  onComponentClick?: (componentId: string) => void;
  showDetails?: boolean;
  estimates?: DisciplineEstimate[];
}) {
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
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isUnlinking, startUnlinking] = useTransition();

  // Mission 20260910-182104, F029 (AS-058, AS-059): unlink this one
  // section instance from its component. `unlinkComponentFromSection`
  // only touches this section's row, so other instances of the same
  // component are unaffected, and the section's own name (`title`) is
  // never part of that update -- it survives unlinking untouched.
  function handleUnlink() {
    startUnlinking(async () => {
      const result = await unlinkComponentFromSection(section.id);

      if (result.success) {
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

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
      data-section-kind={section.kind}
      // F032 (AS-069): a section linked to a component is tinted with the
      // --component-* tokens, echoing Webflow's green component card.
      // CMS-driven sections take the --cms-* lilac instead, matching the
      // CMS page badge -- and CMS wins when a section is both, because
      // "where does this content come from" is the more load-bearing fact
      // when reading a sitemap than "which component renders it".
      className={cn(
        "group relative w-full rounded-md border bg-card p-3 shadow-xs transition-colors",
        sectionKindAccentClassName(section),
      )}
    >
      <div className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        {section.component === null ? (
          <>
            <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
              <PopoverTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="Link component"
                    title="Link component"
                    className="shrink-0"
                  >
                    <Link2 className="size-4" aria-hidden="true" />
                  </Button>
                }
              />
              <PopoverContent align="end" className="w-64 p-0">
                <ComponentPicker
                  projectId={projectId}
                  sectionId={section.id}
                  currentComponentId={null}
                  components={components}
                  onClose={() => setIsPickerOpen(false)}
                />
              </PopoverContent>
            </Popover>
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
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Unlink component"
            title="Unlink component"
            className="shrink-0 text-xs text-muted-foreground"
            disabled={isUnlinking}
            onClick={handleUnlink}
          >
            Unlink
          </Button>
        )}
        <SectionClientVisibilityToggle section={section} />
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
      ) : section.component ? (
        // F027 (AS-054, AS-055, AS-056): when a component is linked, its
        // name is the primary label -- the section's own title becomes a
        // secondary "local title" shown underneath in muted text. The
        // local title stays the click-to-edit target so renaming the
        // section (not the component) keeps working exactly as before.
        <div className="min-w-0 pr-6">
          {/* F035 (AS-084): clicking the linked component's name opens
              that component's detail in the components panel. */}
          <button
            type="button"
            onClick={() => onComponentClick?.(section.component!.id)}
            className="block w-full truncate rounded-sm text-left text-sm font-medium hover:bg-muted/50"
          >
            {section.component.name}
          </button>
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
            className="truncate rounded-sm text-xs text-muted-foreground hover:bg-muted/50"
          >
            {section.title}
          </p>
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
      {showDetails && (
        <div className="mt-1">
          <EstimateChip
            taskId={section.id}
            taskTitle={section.title}
            estimates={estimates ?? []}
          />
        </div>
      )}
    </div>
  );
}
