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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  // R4-1/R4-2 — rename is a dialog rendered outside the dropdown, not an
  // input inside DropdownMenuContent. The dropdown's own keyboard handling
  // (letter keys for typeahead, Enter to activate an item) intercepted
  // keystrokes and turned Enter into "delete this row" when the input lived
  // inside the menu popup. Closing the dropdown before opening the dialog
  // avoids that entirely.
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingVersion, setRenamingVersion] = useState<Version | null>(null);
  const [draftName, setDraftName] = useState("");

  // TH-217 — most-recent-first.
  const mostRecentFirst = [...versions].sort((a, b) => b.createdAt - a.createdAt);

  const startRename = (version: Version) => {
    if (version.isOriginal) return;
    setMenuOpen(false);
    setRenamingVersion(version);
    setDraftName(version.name);
  };

  const commitRename = () => {
    if (!renamingVersion) return;
    const trimmed = draftName.trim();
    if (trimmed) onRename(renamingVersion.id, trimmed);
    setRenamingVersion(null);
    setDraftName("");
  };

  const cancelRename = () => {
    setRenamingVersion(null);
    setDraftName("");
  };

  return (
    <>
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
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

            return (
              <div
                key={version.id}
                data-testid={`version-row-${version.id}`}
                className="flex items-center justify-between gap-1 rounded-sm px-1.5 py-1 hover:bg-accent"
              >
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
                {version.isOriginal ? null : (
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
    <Dialog
      open={renamingVersion !== null}
      onOpenChange={(open) => {
        if (!open) cancelRename();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename version</DialogTitle>
        </DialogHeader>
        <Input
          ref={(node) => {
            node?.focus();
          }}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
          className="text-sm"
        />
        <DialogFooter>
          <Button variant="outline" onClick={cancelRename}>
            Cancel
          </Button>
          <Button onClick={commitRename}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
