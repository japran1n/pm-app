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
// F082 (TH-205, TH-206): each tab's header has its own "+" that creates a
// file of that tab's type (`onCreate("css")` / `onCreate("js")`). A default
// name (`new-style.css` / `new-script.js`) is assigned by the caller.
//
// moden-style layout: a CSS / JS segmented control sits above the list and
// only the selected type's files are shown, under a "CSS FILES" /
// "JS FILES" header. Rows are two lines: mono file name, then a
// "<version> / <origin>" sub-label. The tab is controlled via `tab` /
// `onTabChange` when provided; otherwise it follows the active file.

import { useRef, useState } from "react";
import { Braces, Palette, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type FileTab = "css" | "js";

export interface FileListEntry {
  index: number;
  name: string;
  type: FileTab;
  isDirty?: boolean;
  /** True when the active version for this block is not the Original
   * version (TH-218). Rendered as a distinct "modified" indicator from the
   * unsaved-changes dirty dot. */
  isModified?: boolean;
  /** Second line under the name, e.g. "Original / Embed". */
  subLabel?: string;
  /** Number of page tags this file stands for (repeated CMS embeds). */
  occurrences?: number;
}

export interface FileListProps {
  blocks: FileListEntry[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onRename?: (index: number, newName: string) => void;
  onCreate?: (type: FileTab) => void;
  /** Deletes the file at `index`. Returns true if the deletion happened
   * (TH-207). Omitted entirely disables the delete control. */
  onDelete?: (index: number) => boolean;
  /** Controlled tab. When omitted the list manages it internally and
   * follows the active file's type. */
  tab?: FileTab;
  onTabChange?: (tab: FileTab) => void;
}

const MAX_NAME_LENGTH = 60;

const TABS: { value: FileTab; label: string }[] = [
  { value: "css", label: "CSS" },
  { value: "js", label: "JS" },
];

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
  onDelete,
  tab: tabProp,
  onTabChange,
}: FileListProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const itemRefs = useRef<Map<number, HTMLLIElement>>(new Map());

  const activeType = blocks.find((b) => b.index === activeIndex)?.type;
  const [internalTab, setInternalTab] = useState<FileTab>(activeType ?? "css");
  // Uncontrolled: follow the active file into its tab when it changes
  // ("adjusting state during render" -- no effect needed).
  const [lastActiveType, setLastActiveType] = useState(activeType);
  if (activeType !== lastActiveType) {
    setLastActiveType(activeType);
    if (activeType) setInternalTab(activeType);
  }
  const tab = tabProp ?? internalTab;

  function selectTab(next: FileTab) {
    if (tabProp === undefined) setInternalTab(next);
    onTabChange?.(next);
  }

  const visible = blocks.filter((b) => b.type === tab);

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
    const order = visible.map((b) => b.index);
    const pos = order.indexOf(fromIndex);
    if (pos === -1) return;
    const nextPos = pos + direction;
    if (nextPos < 0 || nextPos >= order.length) return;
    itemRefs.current.get(order[nextPos])?.focus();
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

  const Icon = tab === "css" ? Palette : Braces;

  return (
    <div
      data-testid="file-list"
      className="flex w-60 flex-shrink-0 flex-col gap-2 overflow-y-auto border-r border-border py-2"
    >
      <div
        role="tablist"
        aria-label="File type"
        className="mx-2 grid grid-cols-2 gap-0.5 rounded-md border border-border bg-muted/50 p-0.5"
      >
        {TABS.map((t) => {
          const selected = t.value === tab;
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`file-tab-${t.value}`}
              onClick={() => selectTab(t.value)}
              className={cn(
                "rounded-sm px-2 py-1 text-sm font-medium transition-colors duration-200",
                selected
                  ? "border border-border bg-card text-foreground shadow-xs"
                  : "border border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between px-3">
        <span className="text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">
          {tab === "css" ? "CSS files" : "JS files"}
        </span>
        {onCreate && (
          <button
            type="button"
            aria-label={tab === "css" ? "Create CSS file" : "Create JS file"}
            data-testid="create-file-button"
            onClick={() => onCreate(tab)}
            className="rounded-md p-1 text-muted-foreground transition-colors duration-200 hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>

      <ul role="listbox" aria-label="Files" className="flex flex-col gap-0.5 px-2">
        {visible.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-muted-foreground">
            No {tab === "css" ? "CSS" : "JS"} files
          </li>
        )}
        {visible.map((entry) => {
          const isActive = entry.index === activeIndex;
          const isEditing = editingIndex === entry.index;
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
                "group flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 outline-none transition-colors duration-200 focus-visible:border-border-control-hover",
                isActive
                  ? "border-border bg-muted"
                  : "border-transparent hover:bg-muted/50",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col">
                {isEditing ? (
                  <input
                    ref={(el) => {
                      // Focus the rename field once it mounts (jsx-a11y flags
                      // the `autoFocus` prop directly).
                      el?.focus();
                    }}
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
                    className="min-w-0 rounded-sm border border-border bg-background px-1 font-mono text-sm"
                  />
                ) : (
                  <span
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startRename(entry);
                    }}
                    title={entry.name}
                    className="truncate font-mono text-sm text-foreground"
                  >
                    {entry.name}
                  </span>
                )}
                {entry.subLabel && (
                  <span
                    data-testid={`file-sublabel-${entry.index}`}
                    className="truncate text-xs text-muted-foreground"
                  >
                    {entry.subLabel}
                  </span>
                )}
              </div>
              {entry.occurrences !== undefined && entry.occurrences > 1 && (
                <span
                  data-testid={`occurrences-${entry.index}`}
                  title={`Used ${entry.occurrences} times on the page`}
                  className="shrink-0 font-mono text-xs text-muted-foreground"
                >
                  ×{entry.occurrences}
                </span>
              )}
              {entry.isModified && (
                <span
                  data-testid={`modified-indicator-${entry.index}`}
                  aria-label="modified from original"
                  title="Modified from original"
                  className="text-primary"
                >
                  •
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
              {onDelete && (
                <button
                  type="button"
                  aria-label={`Delete ${entry.name}`}
                  data-testid={`delete-file-${entry.index}`}
                  disabled={blocks.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (blocks.length <= 1) return;
                    onDelete(entry.index);
                  }}
                  className={cn(
                    "shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted/50 hover:text-foreground focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-40",
                    isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
