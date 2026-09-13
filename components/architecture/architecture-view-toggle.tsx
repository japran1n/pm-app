"use client";

import { useState } from "react";
import { LayoutGrid, Network } from "lucide-react";

import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";
import { ArchitectureBoard } from "@/components/architecture/board";
import { CanvasBoard } from "@/components/architecture/canvas-board";

type ViewMode = "board" | "canvas";

export function ArchitectureViewToggle({
  pages,
  components,
  projectId,
  projectName,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
  projectId: string;
  projectName: string;
}) {
  const [view, setView] = useState<ViewMode>("canvas");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Toggle */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-muted-foreground">
          Pages and sections here are the same records as tasks and subtasks
          in the List and Board task views -- edits made in one view show up
          in the other.
        </p>
        <div className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-muted/30 p-0.5">
          <button
            type="button"
            onClick={() => setView("board")}
            title="Column view"
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              view === "board"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            type="button"
            onClick={() => setView("canvas")}
            title="Canvas view"
            className={`flex h-7 w-7 items-center justify-center rounded transition-colors ${
              view === "canvas"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Network size={14} />
          </button>
        </div>
      </div>

      {view === "board" ? (
        <ArchitectureBoard pages={pages} components={components} projectId={projectId} />
      ) : (
        <CanvasBoard
          pages={pages}
          components={components}
          projectId={projectId}
          projectName={projectName}
        />
      )}
    </div>
  );
}
