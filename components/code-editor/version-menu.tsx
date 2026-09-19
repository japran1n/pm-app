"use client";

// F085 — version dropdown, opened from a clock icon button in the editor
// toolbar. Lists saved versions for the active block (F084's
// lib/code-editor/versions.ts); clicking a row restores that version's
// content via `onRestore`.

import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BlockVersion } from "@/lib/code-editor/versions";

export interface VersionMenuProps {
  versions: BlockVersion[];
  onRestore: (content: string) => void;
}

function formatTimestamp(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return String(timestamp);
  }
}

/**
 * Clock-icon trigger in the editor toolbar that opens a dropdown of saved
 * versions for the active block. Empty state shows a disabled placeholder
 * row rather than hiding the trigger, so the control's location stays
 * stable regardless of whether history exists yet.
 */
export function VersionMenu({ versions, onRestore }: VersionMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label="Version history"
            title="Version history"
          >
            <Clock />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Version history</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {versions.length === 0 ? (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              No saved versions yet
            </div>
          ) : (
            [...versions].reverse().map((version) => {
              const originalIndex = versions.indexOf(version);
              return (
                <DropdownMenuItem
                  key={`${version.timestamp}-${originalIndex}`}
                  onClick={() => onRestore(version.content)}
                >
                  <span className="flex flex-col">
                    <span className="font-mono text-sm">
                      {formatTimestamp(version.timestamp)}
                    </span>
                    {version.label ? (
                      <span className="text-xs text-muted-foreground">
                        {version.label}
                      </span>
                    ) : null}
                  </span>
                </DropdownMenuItem>
              );
            })
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
