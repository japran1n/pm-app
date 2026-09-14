"use client";

// Scope & Decisions portal page — "Documents & links" panel. Lets the
// team attach a file (contract, brief) or a link (e.g. a Figma proposal)
// to a project's scope, and lists every one already attached.
//
// Bucket is private (scope-documents, 20261106010000), so an 'upload'
// row's URL is never persisted or embedded directly — same convention as
// components/portal/file-list.tsx: a click requests a fresh signed URL
// (1-hour TTL) and opens it, rather than rendering a permanent link.
//
// Read-only for a client caller (write RLS on project_scope_documents is
// team-only, 20261106010000) — the "Add document" control below is only
// rendered when `canManage` is true, which the page passes based on the
// caller's own role, mirroring how other team-only controls elsewhere in
// this portal shell are gated (e.g. deliverable accept/decline buttons).
import { useRef, useState, useTransition } from "react";
import {
  FileText,
  Link as LinkIcon,
  Loader2,
  Paperclip,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import {
  createScopeDocumentLink,
  deleteScopeDocument,
  getScopeDocumentSignedUrl,
  uploadScopeDocument,
} from "@/lib/actions/scope-documents";
import { validateAttachmentFile } from "@/lib/tasks/validate-attachment-file";
import type { ScopeDocument } from "@/lib/queries/project-scope-documents";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import { formatDate } from "@/lib/format";

function DocumentRow({
  document,
  canManage,
  onDeleted,
}: {
  document: ScopeDocument;
  canManage: boolean;
  onDeleted: (id: string) => void;
}) {
  const [isOpening, startOpening] = useTransition();
  const [isDeleting, startDeleting] = useTransition();

  function handleOpen() {
    if (document.kind === "link") {
      window.open(document.url ?? "#", "_blank", "noopener,noreferrer");
      return;
    }

    startOpening(async () => {
      const result = await getScopeDocumentSignedUrl(document.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      window.open(result.signedUrl, "_blank", "noopener,noreferrer");
    });
  }

  function handleDelete() {
    startDeleting(async () => {
      const result = await deleteScopeDocument(document.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDeleted(document.id);
    });
  }

  const Icon = document.kind === "link" ? LinkIcon : FileText;

  return (
    <li
      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2.5 text-sm"
      data-testid="scope-document-row"
    >
      <button
        type="button"
        onClick={handleOpen}
        disabled={isOpening}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        {isOpening ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate font-medium">{document.title}</span>
      </button>
      <span className="shrink-0 text-xs text-muted-foreground">
        {document.uploadedByName ?? "Unknown"} · {formatDate(document.createdAt)}
      </span>
      {canManage && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={isDeleting}
          onClick={handleDelete}
          aria-label={`Remove ${document.title}`}
        >
          {isDeleting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Trash2 className="size-4" aria-hidden="true" />
          )}
        </Button>
      )}
    </li>
  );
}

function AddDocumentDialog({
  projectId,
  onAdded,
}: {
  projectId: string;
  onAdded: (document: ScopeDocument) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"upload" | "link">("upload");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setMode("upload");
    setTitle("");
    setUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }

    if (mode === "link") {
      startTransition(async () => {
        const result = await createScopeDocumentLink({
          projectId,
          title: title.trim(),
          url: url.trim(),
        });
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        onAdded(result.data);
        toast.success("Link added.");
        setOpen(false);
        reset();
      });
      return;
    }

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      toast.error("Choose a file to upload.");
      return;
    }

    const validation = validateAttachmentFile(file);
    if (!validation.ok) {
      toast.error(validation.reason);
      return;
    }

    const formData = new FormData();
    formData.set("projectId", projectId);
    formData.set("title", title.trim());
    formData.set("file", file);

    startTransition(async () => {
      const result = await uploadScopeDocument(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onAdded(result.data);
      toast.success("Document uploaded.");
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" data-testid="add-scope-document-trigger">
            <Plus className="size-4" aria-hidden="true" />
            Add document
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a document or link</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="scope-document-title">Title</Label>
            <Input
              id="scope-document-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Figma proposal, Signed contract"
              required
            />
          </div>

          <RadioGroup
            value={mode}
            onValueChange={(value) => setMode(value as "upload" | "link")}
            className="flex gap-4"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="upload" id="scope-document-mode-upload" />
              <Label htmlFor="scope-document-mode-upload" className="font-normal">
                Upload a file
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="link" id="scope-document-mode-link" />
              <Label htmlFor="scope-document-mode-link" className="font-normal">
                Add a link
              </Label>
            </div>
          </RadioGroup>

          {mode === "upload" ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="scope-document-file">File</Label>
              <Input
                id="scope-document-file"
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,image/*,text/plain,text/csv"
              />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="scope-document-url">URL</Label>
              <Input
                id="scope-document-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://www.figma.com/..."
                required
              />
            </div>
          )}

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="size-4" aria-hidden="true" />
              )}
              {mode === "upload" ? "Upload" : "Add link"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ScopeDocuments({
  projectId,
  documents,
  canManage,
}: {
  projectId: string;
  documents: ScopeDocument[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(documents);

  function handleAdded(document: ScopeDocument) {
    setItems((prev) => [document, ...prev]);
  }

  function handleDeleted(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }

  return (
    <div className="flex flex-col gap-3" data-testid="scope-documents">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">Documents &amp; links</h2>
        {canManage && (
          <AddDocumentDialog projectId={projectId} onAdded={handleAdded} />
        )}
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No documents or links attached yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((document) => (
            <DocumentRow
              key={document.id}
              document={document}
              canManage={canManage}
              onDeleted={handleDeleted}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
