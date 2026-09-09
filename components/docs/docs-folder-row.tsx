"use client";

// One folder row inside DocsSidebar (W3, docs/docs-system-plan.md).
//
// Renders itself plus (recursively) its child folders and the docs that
// live directly in it — the recursion is what makes "nested folders to N
// levels of depth" (W3 acceptance criteria) just fall out of the
// component tree instead of needing a depth-tracking algorithm.
//
// Kept as its own file (rather than inlined in DocsSidebar) because the
// inline-rename state (`isRenaming`) is local to a single row and would
// otherwise leak into the tree-building parent.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  MoreHorizontal,
  FileText,
  FolderInput,
  GripVertical,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Doc, DocFolder } from "@/lib/queries/docs";
import {
  createDoc,
  createDocFolder,
  deleteDoc,
  deleteDocFolder,
  moveDoc,
  renameDocFolder,
} from "@/lib/actions/docs";
import { Input } from "@/components/ui/input";

export type FolderNode = DocFolder & { children: FolderNode[] };

// DnD-kit id prefixes for the docs sidebar's drag-and-drop wiring (see
// DocsSidebar's DndContext, the single top-level context wrapping both
// the folder tree and the root docs list). Kept as string prefixes on a
// single flat DndContext id-space, same convention as
// components/views/view-drop-context.tsx.
export const DOC_DRAG_ID_PREFIX = "docs-drag-doc:";
export const FOLDER_DROP_ID_PREFIX = "docs-drop-folder:";
export const ROOT_DROP_ID = "docs-drop-root";

function docHref(
  workspaceSlug: string,
  projectId: string | undefined,
  docId: string,
) {
  return projectId
    ? `/w/${workspaceSlug}/projects/${projectId}/docs/${docId}`
    : `/w/${workspaceSlug}/docs/${docId}`;
}

function truncateTitle(title: string) {
  return title.length > 28 ? `${title.slice(0, 27)}…` : title;
}

export function DocsFolderRow({
  folder,
  docsByFolder,
  workspaceSlug,
  projectId,
  currentDocId,
  workspaceId,
  allFolders,
  depth,
}: {
  folder: FolderNode;
  docsByFolder: Map<string | null, Doc[]>;
  workspaceSlug: string;
  projectId?: string;
  currentDocId?: string;
  workspaceId: string;
  allFolders: DocFolder[];
  depth: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [isRenaming, setIsRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(folder.name);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [creatingSubfolder, setCreatingSubfolder] = useState(false);
  const [newSubfolderName, setNewSubfolderName] = useState("");

  // Synchronous re-entrancy guards for the rename/create-subfolder inputs
  // below: each is wired to BOTH onKeyDown(Enter) and onBlur with no
  // dependency on React's (async, next-tick) `isPending` state, so a
  // real browser fires Enter's keydown handler AND the blur handler it
  // triggers before either submit's `startTransition` has flipped
  // `isPending` -- without this ref, that double-fire created two
  // subfolders / duplicate renames per single Enter press. Reset when
  // the corresponding input is reopened (handleNewSubfolder / the
  // "Rename" menu click), matching submitNewFolder's own guard in
  // DocsSidebar.
  const renameSubmittedRef = useRef(false);
  const subfolderSubmittedRef = useRef(false);

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `${FOLDER_DROP_ID_PREFIX}${folder.id}`,
    data: { folderId: folder.id },
  });

  const childDocs = docsByFolder.get(folder.id) ?? [];
  const indent = { paddingLeft: `${depth * 16}px` };

  function submitRename() {
    if (renameSubmittedRef.current) return;
    renameSubmittedRef.current = true;
    setIsRenaming(false);
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === folder.name) {
      setNameDraft(folder.name);
      return;
    }
    startTransition(async () => {
      const result = await renameDocFolder(folder.id, trimmed);
      if ("error" in result && result.error) {
        toast.error(result.error);
        setNameDraft(folder.name);
        return;
      }
      router.refresh();
    });
  }

  function handleNewSubfolder() {
    setNewSubfolderName("");
    subfolderSubmittedRef.current = false;
    setCreatingSubfolder(true);
    setOpen(true);
  }

  function submitNewSubfolder() {
    if (subfolderSubmittedRef.current) return;
    subfolderSubmittedRef.current = true;
    const trimmed = newSubfolderName.trim();
    if (!trimmed) {
      setCreatingSubfolder(false);
      return;
    }
    startTransition(async () => {
      const result = await createDocFolder(
        workspaceId,
        trimmed,
        folder.id,
        projectId ?? null,
      );
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCreatingSubfolder(false);
      setNewSubfolderName("");
      router.refresh();
    });
  }

  function handleNewDoc() {
    startTransition(async () => {
      const result = await createDoc(workspaceId, folder.id, projectId ?? null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      router.push(docHref(workspaceSlug, projectId, result.id));
    });
  }

  function handleDeleteFolder() {
    setConfirmDeleteOpen(false);
    startTransition(async () => {
      const result = await deleteDocFolder(folder.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDeleteDoc(docId: string) {
    startTransition(async () => {
      const result = await deleteDoc(docId);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div
          ref={setDropRef}
          className={cn(
            "group flex items-center gap-1 rounded-md px-1.5 py-1 text-mini hover:bg-accent/50",
            isOver && "bg-primary/10 ring-1 ring-primary/40",
          )}
          style={indent}
        >
          <CollapsibleTrigger
            className="flex flex-1 items-center gap-1 text-left"
            aria-label={open ? "Collapse folder" : "Expand folder"}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            {isRenaming ? (
              <input
                autoFocus
                className="min-w-0 flex-1 rounded border border-input bg-background px-1 py-0.5 text-mini outline-none"
                value={nameDraft}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={submitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submitRename();
                  } else if (e.key === "Escape") {
                    setNameDraft(folder.name);
                    setIsRenaming(false);
                  }
                }}
              />
            ) : (
              <span className="truncate">{folder.name}</span>
            )}
          </CollapsibleTrigger>

          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100 data-[popup-open]:opacity-100"
              aria-label="Folder actions"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  setNameDraft(folder.name);
                  renameSubmittedRef.current = false;
                  setIsRenaming(true);
                }}
              >
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleNewSubfolder} disabled={isPending}>
                New subfolder
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleNewDoc} disabled={isPending}>
                New doc
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setConfirmDeleteOpen(true)}
                disabled={isPending}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <CollapsibleContent>
          <div className="flex flex-col">
            {creatingSubfolder && (
              <div
                className="mb-1 flex items-center gap-1 px-1.5"
                style={{ paddingLeft: `${(depth + 1) * 16}px` }}
              >
                <Input
                  autoFocus
                  placeholder="Subfolder name"
                  value={newSubfolderName}
                  disabled={isPending}
                  className="h-7 text-mini"
                  onChange={(event) => setNewSubfolderName(event.target.value)}
                  onBlur={submitNewSubfolder}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      submitNewSubfolder();
                    } else if (event.key === "Escape") {
                      setCreatingSubfolder(false);
                      setNewSubfolderName("");
                    }
                  }}
                />
              </div>
            )}
            {folder.children.map((child) => (
              <DocsFolderRow
                key={child.id}
                folder={child}
                docsByFolder={docsByFolder}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                currentDocId={currentDocId}
                workspaceId={workspaceId}
                allFolders={allFolders}
                depth={depth + 1}
              />
            ))}
            {childDocs.map((doc) => (
              <DocsDocRow
                key={doc.id}
                doc={doc}
                workspaceSlug={workspaceSlug}
                projectId={projectId}
                currentDocId={currentDocId}
                allFolders={allFolders}
                depth={depth + 1}
                onDelete={handleDeleteDoc}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{folder.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              Sub-folders will be deleted too. Documents inside will move to
              the root instead of being deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteFolder}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function DocsDocRow({
  doc,
  workspaceSlug,
  projectId,
  currentDocId,
  allFolders,
  depth,
  onDelete,
}: {
  doc: Doc;
  workspaceSlug: string;
  projectId?: string;
  currentDocId?: string;
  allFolders: DocFolder[];
  depth: number;
  onDelete: (docId: string) => void;
}) {
  const router = useRouter();
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const indent = { paddingLeft: `${depth * 16 + 18}px` };

  // Drag handle rendered as its own small element (NOT the whole row):
  // the row already has a click-to-open handler (below) and a dropdown
  // menu trigger, so making the entire row draggable would fight those
  // gestures -- same reasoning components/views/view-drop-context.tsx's
  // TaskDragHandle applies to its own row.
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `${DOC_DRAG_ID_PREFIX}${doc.id}`,
    data: { docId: doc.id },
  });

  async function handleMoveTo(folderId: string | null) {
    setMovePickerOpen(false);
    const result = await moveDoc(doc.id, folderId);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-1.5 py-1 text-mini hover:bg-accent/50",
        doc.id === currentDocId && "bg-accent",
        isDragging && "opacity-50",
      )}
      style={indent}
    >
      <button
        ref={setDragRef}
        type="button"
        aria-label="Drag to move to a folder"
        title="Drag onto a folder to move this doc"
        className="cursor-grab touch-none opacity-0 group-hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <button
        type="button"
        className="flex flex-1 items-center gap-1.5 text-left"
        onClick={() => router.push(docHref(workspaceSlug, projectId, doc.id))}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate" title={doc.title}>
          {truncateTitle(doc.title)}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100 data-[popup-open]:opacity-100"
          aria-label="Document actions"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <Popover open={movePickerOpen} onOpenChange={setMovePickerOpen}>
            <PopoverTrigger
              render={
                <DropdownMenuItem
                  closeOnClick={false}
                  onClick={(e) => {
                    e.preventDefault();
                    setMovePickerOpen(true);
                  }}
                >
                  <FolderInput className="h-3.5 w-3.5" aria-hidden="true" />
                  Move to...
                </DropdownMenuItem>
              }
            />
            <PopoverContent align="start" className="w-64 p-0">
              <Command>
                <CommandList>
                  <CommandEmpty>No folders yet.</CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="root"
                      onClick={() => handleMoveTo(null)}
                    >
                      No folder (root)
                    </CommandItem>
                    {allFolders.map((folder) => (
                      <CommandItem
                        key={folder.id}
                        value={folder.name}
                        onClick={() => handleMoveTo(folder.id)}
                      >
                        {folder.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onDelete(doc.id)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
