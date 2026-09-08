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

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  MoreHorizontal,
  FileText,
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
import type { Doc, DocFolder } from "@/lib/queries/docs";
import {
  createDoc,
  createDocFolder,
  deleteDoc,
  deleteDocFolder,
  renameDocFolder,
} from "@/lib/actions/docs";
import { Input } from "@/components/ui/input";

export type FolderNode = DocFolder & { children: FolderNode[] };

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
  depth,
}: {
  folder: FolderNode;
  docsByFolder: Map<string | null, Doc[]>;
  workspaceSlug: string;
  projectId?: string;
  currentDocId?: string;
  workspaceId: string;
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

  const childDocs = docsByFolder.get(folder.id) ?? [];
  const indent = { paddingLeft: `${depth * 16}px` };

  function submitRename() {
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
    setCreatingSubfolder(true);
    setOpen(true);
  }

  function submitNewSubfolder() {
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
          className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-mini hover:bg-accent/50"
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
  depth,
  onDelete,
}: {
  doc: Doc;
  workspaceSlug: string;
  projectId?: string;
  currentDocId?: string;
  depth: number;
  onDelete: (docId: string) => void;
}) {
  const router = useRouter();
  const indent = { paddingLeft: `${depth * 16 + 18}px` };

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md px-1.5 py-1 text-mini hover:bg-accent/50",
        doc.id === currentDocId && "bg-accent",
      )}
      style={indent}
    >
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
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem
            onClick={() => {
              const target = window.prompt(
                "Move to folder id (leave empty for root):",
              );
              if (target === null) return;
              import("@/lib/actions/docs").then(({ moveDoc }) =>
                moveDoc(doc.id, target.trim() || null),
              );
            }}
          >
            Move to...
          </DropdownMenuItem>
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
