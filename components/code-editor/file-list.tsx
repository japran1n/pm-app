"use client";

// F080 (TH-200..TH-203 subset rendered here): file list sidebar showing
// extracted CSS/JS blocks. Each row shows a type icon, name, and a dirty
// marker. The active row is highlighted. Arrow keys move focus between
// rows and Enter selects the focused row.
//
// F081 (TH-204): double-clicking a row's name switches it into an inline
// text input. Escape reverts to the original name without emitting
// `onRename`; Enter commits, but only if the trimmed name is non-empty and
// at most 60 characters -- otherwise the edit is rejected and the input
// stays open so the user can fix it.
//
// F082 (TH-205, TH-206): a "+" control lets the user pick css or js and
// create a new empty file. The new block's index is one past the highest
// existing index, content starts empty, and a default name
// (`new-style.css` / `new-script.js`) is assigned by the caller via
// `onCreate`; this component only reports which type was requested.

import { useRef, useState } from "react";
import { Braces, Palette, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FileListEntry {
  index: number;
  name: string;
  type: "css" | "js";
  isDirty?: boolean;
}

export interface FileListProps {
  blocks: FileListEntry[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onRename?: (index: number, newName: string) => void;
  onCreate?: (type: "css" | "js") => void;
}

const MAX_NAME_LENGTH = 60;

export function isValidFileName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
}

export function FileList({
  blocks,
  activeIndex,
  onSelect,
  onRename,
  onCreate,
}: FileListProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [createType, setCreateType] = useState<"css" | "js">("css");
  const [showCreateMenu, setShowCreateMenu] = useState(false);
  const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  function startRename(entry: FileListEntry) {
    if (!onRename) return;
    setEditingIndex(entry.index);
    setDraftName(entry.name);
  }

  function cancelRename() {
    setEditingIndex(null);
    setDraftName("");
  }

  function commitRename(index: number) {
    if (!isValidFileName(draftName)) {
      // Invalid: keep the input open so the user can correct it.
      return;
    }
    onRename?.(index, draftName.trim());
    setEditingIndex(null);
    setDraftName("");
  }

  function moveFocus(fromIndex: number, direction: 1 | -1) {
    const order = blocks.map((b) => b.index);
    const pos = order.indexOf(fromIndex);
    if (pos === -1) return;
    const nextPos = pos + direction;
    if (nextPos < 0 || nextPos >= order.length) return;
    const nextIndex = order[nextPos];
    itemRefs.current.get(nextIndex)?.focus();
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLLIElement>,
    entry: FileListEntry,
  ) {
    if (editingIndex !== null) return;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(entry.index, 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(entry.index, -1);
        break;
      case "Enter":
        event.preventDefault();
        onSelect(entry.index);
        break;
      default:
        break;
    }
  }

  return (
    <div data-testid="file-list" className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-2">
        <span className="text-sm font-medium">Files</span>
        {onCreate && (
          <div className="relative">
            <button
              type="button"
              aria-label="Create file"
              data-testid="create-file-button"
              onClick={() => setShowCreateMenu((v) => !v)}
              className="rounded-md p-1 hover:bg-muted/50"
            >
              <Plus className="h-4 w-4" />
            </button>
            {showCreateMenu && (
              <div
                data-testid="create-file-menu"
                className="absolute right-0 z-10 mt-1 flex flex-col gap-1 rounded-md border bg-popover p-1 shadow-xs"
              >
                <label className="flex items-center gap-1 px-1 text-sm">
                  <input
                    type="radio"
                    name="create-file-type"
                    value="css"
                    checked={createType === "css"}
                    onChange={() => setCreateType("css")}
                  />
                  CSS
                </label>
                <label className="flex items-center gap-1 px-1 text-sm">
                  <input
                    type="radio"
                    name="create-file-type"
                    value="js"
                    checked={createType === "js"}
                    onChange={() => setCreateType("js")}
                  />
                  JS
                </label>
                <button
                  type="button"
                  data-testid="confirm-create-file"
                  className="rounded-md bg-accent px-2 py-1 text-sm hover:bg-muted/50"
                  onClick={() => {
                    onCreate(createType);
                    setShowCreateMenu(false);
                  }}
                >
                  Add
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <ul role="listbox" aria-label="Files" className="flex flex-col gap-0.5">
        {blocks.map((entry) => {
          const isActive = entry.index === activeIndex;
          const isEditing = editingIndex === entry.index;
          const Icon = entry.type === "css" ? Palette : Braces;
          return (
            <li
              key={entry.index}
              ref={(el) => {
                if (el) itemRefs.current.set(entry.index, el);
                else itemRefs.current.delete(entry.index);
              }}
              role="option"
              aria-selected={isActive}
              tabIndex={0}
              data-testid={`file-row-${entry.index}`}
              onClick={() => !isEditing && onSelect(entry.index)}
              onKeyDown={(e) => handleKeyDown(e, entry)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm outline-none",
                isActive ? "bg-accent" : "hover:bg-muted/50",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {isEditing ? (
                <input
                  autoFocus
                  data-testid={`file-rename-input-${entry.index}`}
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename(entry.index);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={() => cancelRename()}
                  className="min-w-0 flex-1 rounded-sm border bg-background px-1 font-mono text-sm"
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(entry);
                  }}
                  className="flex-1 truncate font-mono"
                >
                  {entry.name}
                </span>
              )}
              {entry.isDirty && (
                <span
                  data-testid={`dirty-indicator-${entry.index}`}
                  aria-label="unsaved changes"
                  className="text-muted-foreground"
                >
                  •
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
