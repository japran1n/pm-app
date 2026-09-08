"use client";

// DocsSidebar (W3, docs/docs-system-plan.md) — folder tree + doc list for
// the docs system, workspace- or project-scoped.
//
// Builds the parent_id tree client-side from the flat `folders` array
// (per the query layer's comment in lib/queries/docs.ts: "the UI builds
// the tree rather than this query doing a recursive fetch"). Root-level
// docs (folderId === null) render below the folder tree.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FilePlus, FolderPlus } from "lucide-react";
import { toast } from "sonner";

import type { Doc, DocFolder } from "@/lib/queries/docs";
import { createDoc, createDocFolder } from "@/lib/actions/docs";
import { DocsDocRow, DocsFolderRow, type FolderNode } from "@/components/docs/docs-folder-row";
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

  const tree = useMemo(() => buildTree(folders), [folders]);
  const docsByFolder = useMemo(() => groupDocsByFolder(docs), [docs]);
  const rootDocs = docsByFolder.get(null) ?? [];

  const docHref = (docId: string) =>
    projectId
      ? `/w/${workspaceSlug}/projects/${projectId}/docs/${docId}`
      : `/w/${workspaceSlug}/docs/${docId}`;

  function handleNewFolder() {
    setNewFolderName("");
    setCreatingFolder(true);
  }

  function submitNewFolder() {
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
        className="mb-2 self-start rounded-md border border-input px-2 py-1 text-xs text-muted-foreground md:hidden"
        onClick={() => setCollapsed((value) => !value)}
      >
        {collapsed ? "Show docs" : "Hide docs"}
      </button>

      <div
        className={collapsed ? "hidden md:flex md:flex-col" : "flex flex-col"}
      >
        <div className="mb-2 flex items-center justify-between px-1.5">
          <h2 className="text-sm font-semibold">Docs</h2>
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
              className="h-7 text-sm"
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
              depth={0}
              onDelete={handleDeleteDoc}
            />
          ))}
          {tree.length === 0 && rootDocs.length === 0 && (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">
              No documents yet.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
