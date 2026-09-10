import { LayoutTemplate } from "lucide-react";

import { Button } from "@/components/ui/button";

// Mission 20260910-182104, F005 (AS-028, AS-030): the empty state shown on
// a project's Architecture board when it has no pages yet. Mirrors
// components/board/board-empty-state.tsx's shape (icon, heading,
// supporting copy, primary action) so the Architecture tab feels
// consistent with the existing Board tab.
//
// "Add first page" is a placeholder trigger for now -- the real
// create-page action (lib/actions, a client dialog) lands in F010. Kept as
// a plain disabled-looking button rather than wiring a stub onClick, so
// nothing here silently no-ops once F010's worker replaces it.
export function ArchitectureBoardEmptyState() {
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
      <Button type="button">Add first page</Button>
    </div>
  );
}
