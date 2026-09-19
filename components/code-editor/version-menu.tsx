"use client";

// F085 — version dropdown, opened from a clock icon button in the editor
// toolbar. Lists named versions for the active block
// (lib/code-editor/versions.ts), most-recent-first (TH-217). "Original" is a
// read-only entry (TH-209/TH-210) that cannot be renamed or deleted. Every
// other version can be restored (click its name), renamed (double-click its
// name, or the rename icon button, TH-212), duplicated (TH-213), or deleted
// (TH-214). The active version shows a "(modified)" badge when its saved
// content differs from the current editor content (TH-218).

import { useState } from "react";
import { Clock, Copy, Lock, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Version } from "@/lib/code-editor/versions";

export interface VersionMenuProps {
  versions: Version[];
  activeVersionId: string | null;
  /** Current, possibly-unsaved editor content for the active block --
   * compared against the active version's snapshot to drive the "modified"
   * badge (TH-218). */
  currentContent: string;
  onRestore: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * Clock-icon trigger in the editor toolbar that opens a dropdown of named
 * versions for the active block. Every block always has at least
 * "Original", so there's no empty state.
 */
export function VersionMenu({
  versions,
  activeVersionId,
  currentContent,
  onRestore,
  onRename,
  onDuplicate,
  onDelete,
}: VersionMenuProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  // TH-217 — most-recent-first.
  const mostRecentFirst = [...versions].sort((a, b) => b.createdAt - a.createdAt);

  const startRename = (version: Version) => {
    if (version.isOriginal) return;
    setRenamingId(version.id);
    setDraftName(version.name);
  };

  const commitRename = (id: string) => {
    const trimmed = draftName.trim();
    if (trimmed) onRename(id, trimmed);
    setRenamingId(null);
    setDraftName("");
  };

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
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Version history</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {mostRecentFirst.map((version) => {
            const isActive = version.id === activeVersionId;
            const isModified = isActive && currentContent !== version.content;
            const isRenaming = renamingId === version.id;

            return (
              <div
                key={version.id}
                data-testid={`version-row-${version.id}`}
                className="flex items-center justify-between gap-1 rounded-sm px-1.5 py-1 hover:bg-accent"
              >
                {isRenaming ? (
                  <Input
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(version.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(version.id);
                      if (e.key === "Escape") {
                        setRenamingId(null);
                        setDraftName("");
                      }
                    }}
                    className="h-7 text-sm"
                  />
                ) : (
                  <button
                    type="button"
                    disabled={version.isOriginal}
                    onClick={() => {
                      if (!version.isOriginal) onRestore(version.id);
                    }}
                    onDoubleClick={() => startRename(version)}
                    className="flex min-w-0 flex-1 items-center gap-1 truncate text-left font-mono text-sm disabled:cursor-default"
                  >
                    {version.isOriginal ? <Lock className="size-3 shrink-0" aria-hidden /> : null}
                    <span className="truncate">{version.name}</span>
                    {version.isOriginal ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        (read-only)
                      </span>
                    ) : null}
                    {isModified ? (
                      <span className="shrink-0 text-xs text-muted-foreground">(modified)</span>
                    ) : null}
                  </button>
                )}
                {version.isOriginal || isRenaming ? null : (
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Rename ${version.name}`}
                      onClick={() => startRename(version)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Duplicate ${version.name}`}
                      onClick={() => onDuplicate(version.id)}
                    >
                      <Copy className="size-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Delete ${version.name}`}
                      onClick={() => onDelete(version.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
