"use client";

// Ad-hoc "Projects page card redesign": collapses the projects list
// card's SaveProjectAsTemplateDialog/EditProjectDialog/ArchiveProjectDialog
// into a single "..." (MoreHorizontal) hover/focus-revealed menu, so the
// card's header is the project's own icon/title/description rather than
// four always-visible icon buttons. Kept as its own small Client
// Component (mirrors this codebase's established "smallest possible
// client boundary" convention, e.g. components/new-project-dialog.tsx) so
// the page itself stays a Server Component — the AS-155 "primary content
// in the initial HTML" guarantee is untouched, this component only owns
// the interactive menu + the three dialogs' lifted `open` state.
//
// Every existing permission gate is preserved exactly: `canSaveTemplate`
// still only disables (never hides) the template item with the same
// `disabledTitle` text, and the archive item is still only mounted at all
// when `canArchive` — same as the inline icon row this replaces.
//
// Each dialog is rendered with its `open` state CONTROLLED by this
// wrapper (via each dialog's opt-in `open`/`onOpenChange`/`hideTrigger`
// props) rather than left to its own internal trigger, so closing the
// dropdown (which happens on item click, same base-ui Menu default every
// other DropdownMenuItem in this repo relies on) never unmounts an
// already-open dialog.

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SaveProjectAsTemplateDialog } from "@/components/save-project-as-template-dialog";
import { EditProjectDialog } from "@/components/edit-project-dialog";
import { ArchiveProjectDialog } from "@/components/archive-project-dialog";

export function ProjectCardActions({
  workspaceId,
  canArchive,
  canSaveTemplate,
  project,
}: {
  workspaceId: string;
  canArchive: boolean;
  canSaveTemplate: boolean;
  project: {
    id: string;
    name: string;
    description: string | null;
    startDate: string | null;
    endDate: string | null;
    icon?: string | null;
  };
}) {
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          // Revealed on card hover/focus (`group/card` on the ancestor
          // Card, per the clarified spec) and stays visible while the
          // menu itself is open via base-ui's `data-popup-open` state
          // attribute (same convention DocsFolderRow's own "..." trigger
          // already uses for `group-hover`/open-state visibility).
          className="rounded-md border border-transparent p-1.5 opacity-0 outline-none transition-opacity duration-200 hover:border-border hover:bg-muted/50 focus-visible:opacity-100 group-hover/card:opacity-100 group-focus-within/card:opacity-100 data-[popup-open]:opacity-100"
          aria-label={`More actions for ${project.name}`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={!canSaveTemplate}
            title={!canSaveTemplate ? "You don't have permission to save templates." : undefined}
            onClick={() => setSaveTemplateOpen(true)}
          >
            Save as template
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          {canArchive && (
            <DropdownMenuItem
              variant="destructive"
              onClick={() => setArchiveOpen(true)}
            >
              Archive
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <SaveProjectAsTemplateDialog
        projectId={project.id}
        projectName={project.name}
        disabled={!canSaveTemplate}
        disabledTitle="You don't have permission to save templates."
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        hideTrigger
      />
      <EditProjectDialog
        workspaceId={workspaceId}
        project={project}
        open={editOpen}
        onOpenChange={setEditOpen}
        hideTrigger
      />
      {canArchive && (
        <ArchiveProjectDialog
          workspaceId={workspaceId}
          project={{ id: project.id, name: project.name }}
          open={archiveOpen}
          onOpenChange={setArchiveOpen}
          hideTrigger
        />
      )}
    </>
  );
}
