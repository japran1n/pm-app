"use client";

// Overflow menu for a section card. The card body is for reading (section
// name + linked component name); everything that acts on the section --
// linking/creating/unlinking its component, client visibility, delete --
// lives behind this one "..." trigger so the card stays calm.
//
// Built as a Popover (not a DropdownMenu) deliberately: every row hosts an
// existing control that owns its own Dialog/AlertDialog/Popover
// (DeleteSectionButton, SectionClientVisibilityToggle, ComponentPicker).
// A DropdownMenu closes on item activation, which would unmount those
// overlays mid-interaction; a Popover leaves them mounted. This mirrors
// components/projects/project-card-actions.tsx's "one MoreHorizontal
// trigger instead of a row of icon buttons" convention.

import { useState, useTransition } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Boxes, Link2, MoreHorizontal, Unlink } from "lucide-react";

import {
  createComponentFromSection,
  unlinkComponentFromSection,
} from "@/lib/actions/architecture";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ComponentPicker } from "@/components/architecture/component-picker";
import { DeleteSectionButton } from "@/components/architecture/delete-section-button";
import { SectionClientVisibilityToggle } from "@/components/architecture/section-client-visibility-toggle";
import type { BoardComponent, BoardSection } from "@/lib/queries/architecture";

function MenuRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/50">
      <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function SectionCardMenu({
  section,
  components = [],
}: {
  section: BoardSection;
  components?: BoardComponent[];
}) {
  const router = useRouter();
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;

  const [open, setOpen] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isCreatingComponent, startCreatingComponent] = useTransition();
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`More actions for ${section.title}`}
            className="shrink-0 rounded-md border border-transparent p-1 text-muted-foreground opacity-0 transition-opacity duration-200 hover:border-border-control-hover focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[popup-open]:opacity-100"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-56 p-1">
        {section.component === null ? (
          <>
            <MenuRow label="Link component">
              <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label="Link component"
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
            </MenuRow>
            <MenuRow label="Create component">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Create component"
                className="shrink-0"
                disabled={isCreatingComponent}
                onClick={handleCreateComponent}
              >
                <Boxes className="size-4" aria-hidden="true" />
              </Button>
            </MenuRow>
          </>
        ) : (
          <MenuRow label="Unlink component">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Unlink component"
              className="shrink-0"
              disabled={isUnlinking}
              onClick={handleUnlink}
            >
              <Unlink className="size-4" aria-hidden="true" />
            </Button>
          </MenuRow>
        )}
        <MenuRow label="Client visibility">
          <SectionClientVisibilityToggle section={section} />
        </MenuRow>
        <MenuRow label="Delete section">
          <DeleteSectionButton sectionId={section.id} sectionTitle={section.title} />
        </MenuRow>
      </PopoverContent>
    </Popover>
  );
}
