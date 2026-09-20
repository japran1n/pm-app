"use client";

// Overflow menu for a page card, shared by the column board and the
// canvas. The card body is for reading (page name, estimate, copy brief);
// everything that acts on the page -- its kind, client visibility, delete
// -- lives behind this one "..." trigger.
//
// Built as a Popover (not a DropdownMenu) deliberately: every row hosts an
// existing control that owns its own Dialog/AlertDialog/Popover
// (DeletePageButton, PageClientVisibilityToggle, PageKindSelector). A
// DropdownMenu closes on item activation, which would unmount those
// overlays mid-interaction; a Popover leaves them mounted. Mirrors
// components/projects/project-card-actions.tsx's "one MoreHorizontal
// trigger instead of a row of icon buttons" convention.

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PageKindSelector } from "@/components/architecture/page-kind-selector";
import { PageClientVisibilityToggle } from "@/components/architecture/page-client-visibility-toggle";
import { DeletePageButton } from "@/components/architecture/delete-page-button";
import { useArchitectureActions } from "@/lib/architecture/actions-context";
import type { BoardPage } from "@/lib/queries/architecture";

function MenuRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-2 py-1 transition-colors hover:bg-muted/50">
      <span className="min-w-0 truncate text-sm text-muted-foreground">{label}</span>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  );
}

export function PageCardMenu({ page }: { page: BoardPage }) {
  const { readOnly, clientVisibility } = useArchitectureActions();
  const [open, setOpen] = useState(false);

  // Every row in this menu is a mutation -- read-only boards render no
  // trigger at all rather than an empty/dead popover.
  if (readOnly) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={`More actions for ${page.title}`}
            className="shrink-0 rounded-md border border-transparent p-1 text-muted-foreground transition-colors hover:border-border-control-hover hover:text-foreground"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        }
      />
      <PopoverContent align="end" className="w-56 p-1">
        <MenuRow label="Page kind">
          <PageKindSelector taskId={page.id} kind={page.pageKind} />
        </MenuRow>
        {clientVisibility && (
          <MenuRow label="Client visibility">
            <PageClientVisibilityToggle page={page} />
          </MenuRow>
        )}
        <MenuRow label="Delete page">
          <DeletePageButton page={page} />
        </MenuRow>
      </PopoverContent>
    </Popover>
  );
}
