"use client";

import { useState } from "react";
import { LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CreatePageDialog } from "@/components/architecture/create-page-dialog";

// Mission 20260910-182104, F005 (AS-028, AS-030): the empty state shown on
// a project's Architecture board when it has no pages yet. Mirrors
// components/board/board-empty-state.tsx's shape (icon, heading,
// supporting copy, primary action) so the Architecture tab feels
// consistent with the existing Board tab.
//
// F010 (AS-001, AS-002, AS-031, AS-037): "Add first page" now opens
// <CreatePageDialog>, the real create-page action -- promoted from Client
// Component (was a plain Server Component wrapping a static button)
// since it now owns the dialog's open/close state.
export function ArchitectureBoardEmptyState({ projectId }: { projectId: string }) {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center">
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-muted"
      >
        <LayoutTemplate className="size-6 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold">No pages yet</p>
        <p className="text-sm text-muted-foreground">
          Add your first page to start mapping out this project&apos;s
          architecture.
        </p>
      </div>
      <Button type="button" onClick={() => setDialogOpen(true)}>
        Add first page
      </Button>
      <CreatePageDialog
        projectId={projectId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
