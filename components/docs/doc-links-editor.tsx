"use client";

// F114 (client-portal-phase-2-plan.md, items E-H): the team-side editor
// for a doc's video/document link previews — manual title/description/
// thumbnail fields, not a server-side Open Graph fetch (see this
// feature's handoff "Decisions made" for that call). Rendered inside the
// existing doc editor (markdown-editor.tsx) rather than as a second
// editor, per this feature's own instruction to extend where docs are
// already authored.

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { addDocLink, deleteDocLink } from "@/lib/actions/docs";
import { addDocLinkSchema } from "@/lib/validation/project-site";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocLink } from "@/lib/queries/docs";

export function DocLinksEditor({
  docId,
  initialLinks,
}: {
  docId: string;
  initialLinks: DocLink[];
}) {
  const [links, setLinks] = useState(initialLinks);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState("");
  const [isPending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleAdd() {
    const parsed = addDocLinkSchema.safeParse({
      docId,
      url,
      title,
      description,
      thumbnailUrl,
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid link.");
      return;
    }

    startTransition(async () => {
      const result = await addDocLink(parsed.data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLinks((prev) => [
        ...prev,
        {
          id: result.data.id,
          docId,
          url: parsed.data.url,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          thumbnailUrl: parsed.data.thumbnailUrl ?? null,
          position: prev.length,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]);
      setUrl("");
      setTitle("");
      setDescription("");
      setThumbnailUrl("");
      toast.success("Link added.");
    });
  }

  function handleDelete(linkId: string) {
    setDeletingId(linkId);
    startTransition(async () => {
      const result = await deleteDocLink(linkId);
      setDeletingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setLinks((prev) => prev.filter((link) => link.id !== linkId));
    });
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border p-3"
      data-testid="doc-links-editor"
    >
      <span className="text-sm font-medium text-foreground">Video and document links</span>

      {links.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="doc-links-editor-list">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-2 rounded border border-border p-2 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium text-foreground">{link.title}</span>
                <span className="truncate text-xs font-medium uppercase tracking-[0.07em] text-muted-foreground">{link.url}</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={isPending && deletingId === link.id}
                onClick={() => handleDelete(link.id)}
                aria-label={`Remove ${link.title}`}
              >
                {isPending && deletingId === link.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" aria-hidden="true" />
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Input
          placeholder="Title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Input placeholder="URL" value={url} onChange={(event) => setUrl(event.target.value)} />
        <Input
          placeholder="Description (optional)"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Input
          placeholder="Thumbnail URL (optional)"
          value={thumbnailUrl}
          onChange={(event) => setThumbnailUrl(event.target.value)}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending || !url || !title}
        onClick={handleAdd}
        className="self-start"
      >
        {isPending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="size-4" aria-hidden="true" />
        )}
        Add link
      </Button>
    </div>
  );
}
