"use client";

// DocsSidebar (W3, docs/docs-system-plan.md) — folder tree + doc list for
// the docs system, workspace- or project-scoped.
//
// Builds the parent_id tree client-side from the flat `folders` array
// (per the query layer's comment in lib/queries/docs.ts: "the UI builds
// the tree rather than this query doing a recursive fetch"). Root-level
// docs (folderId === null) render below the folder tree.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

import { cn } from "@/lib/utils";
import type { Doc, DocFolder } from "@/lib/queries/docs";
import { createDoc, createDocFolder, moveDoc } from "@/lib/actions/docs";
import {
  DocsDocRow,
  DocsFolderRow,
  DOC_DRAG_ID_PREFIX,
  FOLDER_DROP_ID_PREFIX,
  ROOT_DROP_ID,
  type FolderNode,
} from "@/components/docs/docs-folder-row";
import { deleteDoc } from "@/lib/actions/docs";
import { Input } from "@/components/ui/input";

function buildTree(folders: DocFolder[]): FolderNode[] {
  const nodesById = new Map<string, FolderNode>();
  for (const folder of folders) {
    nodesById.set(folder.id, { ...folder, children: [] });
  }

  const roots: FolderNode[] = [];
  for (const folder of folders) {
    const node = nodesById.get(folder.id)!;
    if (folder.parentId && nodesById.has(folder.parentId)) {
      nodesById.get(folder.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function groupDocsByFolder(docs: Doc[]): Map<string | null, Doc[]> {
  const map = new Map<string | null, Doc[]>();
  for (const doc of docs) {
    const key = doc.folderId;
    const list = map.get(key) ?? [];
    list.push(doc);
    map.set(key, list);
  }
  return map;
}

export function DocsSidebar({
  folders,
  docs,
  workspaceSlug,
  workspaceId,
  projectId,
  currentDocId,
}: {
  folders: DocFolder[];
  docs: Doc[];
  workspaceSlug: string;
  workspaceId: string;
  projectId?: string;
  currentDocId?: string;
}) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Synchronous re-entrancy guard: see docs-folder-row.tsx's matching
  // comment on renameSubmittedRef/subfolderSubmittedRef for why a ref
  // (not `isPending`) is required to stop Enter's keydown handler and
  // the blur it triggers from both calling submitNewFolder.
  const folderSubmittedRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const tree = useMemo(() => buildTree(folders), [folders]);
  const docsByFolder = useMemo(() => groupDocsByFolder(docs), [docs]);
  const rootDocs = docsByFolder.get(null) ?? [];

  const docHref = (docId: string) =>
    projectId
      ? `/w/${workspaceSlug}/projects/${projectId}/docs/${docId}`
      : `/w/${workspaceSlug}/docs/${docId}`;

  function handleNewFolder() {
    setNewFolderName("");
    folderSubmittedRef.current = false;
    setCreatingFolder(true);
  }

  function submitNewFolder() {
    if (folderSubmittedRef.current) return;
    folderSubmittedRef.current = true;
    const trimmed = newFolderName.trim();
    if (!trimmed) {
      setCreatingFolder(false);
      return;
    }
    startTransition(async () => {
      const result = await createDocFolder(workspaceId, trimmed, null, projectId ?? null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setCreatingFolder(false);
      setNewFolderName("");
      router.refresh();
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId.startsWith(DOC_DRAG_ID_PREFIX)) return;

    const docId = activeId.slice(DOC_DRAG_ID_PREFIX.length);
    let targetFolderId: string | null;
    if (overId === ROOT_DROP_ID) {
      targetFolderId = null;
    } else if (overId.startsWith(FOLDER_DROP_ID_PREFIX)) {
      targetFolderId = overId.slice(FOLDER_DROP_ID_PREFIX.length);
    } else {
      return;
    }

    const result = await moveDoc(docId, targetFolderId);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  function handleNewDoc() {
    startTransition(async () => {
      const result = await createDoc(workspaceId, null, projectId ?? null);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      router.refresh();
      router.push(docHref(result.id));
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
    <>
      <button
        type="button"
        className="mb-2 self-start rounded-md border border-input px-2 py-1 text-micro text-muted-foreground md:hidden"
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? "Show docs" : "Hide docs"}
      </button>

      <div
        className={collapsed ? "hidden md:flex md:flex-col" : "flex flex-col"}
      >
        <div className="mb-2 flex items-center justify-between px-1.5">
          <h2 className="text-mini font-semibold">Docs</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="New folder"
              title="New folder"
              disabled={isPending}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              onClick={handleNewFolder}
            >
              <FolderPlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="New doc"
              title="New doc"
              disabled={isPending}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
              onClick={handleNewDoc}
            >
              <FilePlus className="h-4 w-4" />
            </button>
          </div>
        </div>

        {creatingFolder && (
          <div className="mb-1 flex items-center gap-1 px-1.5">
            <Input
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              disabled={isPending}
              className="h-7 text-mini"
              onChange={(event) => setNewFolderName(event.target.value)}
              onBlur={submitNewFolder}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitNewFolder();
                } else if (event.key === "Escape") {
                  setCreatingFolder(false);
                  setNewFolderName("");
                }
              }}
            />
          </div>
        )}

        <DndContext
          // F272-style explicit id (see components/board/board.tsx /
          // components/views/view-drop-context.tsx): avoids dnd-kit's
          // counter-based auto-id drifting between server/client renders
          // when more than one DndContext mounts in the app.
          id="docs-sidebar-drop-context"
          sensors={sensors}
          onDragEnd={handleDragEnd}
        >
          <RootDropTarget>
            <div className="flex flex-col gap-0.5">
              {tree.map((folder) => (
                <DocsFolderRow
                  key={folder.id}
                  folder={folder}
                  docsByFolder={docsByFolder}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  currentDocId={currentDocId}
                  workspaceId={workspaceId}
                  allFolders={folders}
                  depth={0}
                />
              ))}
              {rootDocs.map((doc) => (
                <DocsDocRow
                  key={doc.id}
                  doc={doc}
                  workspaceSlug={workspaceSlug}
                  projectId={projectId}
                  currentDocId={currentDocId}
                  allFolders={folders}
                  depth={0}
                  onDelete={handleDeleteDoc}
                />
              ))}
              {tree.length === 0 && rootDocs.length === 0 && (
                <p className="px-1.5 py-2 text-micro text-muted-foreground">
                  No documents yet.
                </p>
              )}
            </div>
          </RootDropTarget>
        </DndContext>
      </div>
    </>
  );
}

// Drop target representing "no folder" (root) -- wraps the whole
// tree/root-docs list rather than a small dedicated strip, since any
// empty space below the last row is also a reasonable place to drop a
// doc back to root. Highlighted the same way DocsFolderRow highlights
// itself on drag-over.
function RootDropTarget({ children }: { children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: ROOT_DROP_ID });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-md transition-colors",
        isOver && "bg-primary/5 ring-1 ring-primary/20",
      )}
    >
      {children}
    </div>
  );
}
