"use client";

// F014 (missions/20260903-portal, AS-029, AS-030): the Your list view's
// upload control for one outstanding `client_deliverables` row. Reuses
// `AttachmentDropzone` (components/task/attachment-dropzone.tsx) for the
// drag-and-drop highlight/window-navigation-guard behaviour and
// `validateAttachmentFile` (lib/tasks/validate-attachment-file.ts) for the
// same client-side pre-flight check the task detail sheet's own upload
// control runs — both reused as-is, not re-implemented, per this
// feature's own "reuse the existing storage bucket and policies"
// instruction.
//
// `AttachmentDropzone` renders `display: contents` and expects its
// highlight overlay's `absolute inset-0` to climb to the nearest
// positioned ancestor (see that component's own doc comment) — inside
// the task detail sheet, that's the sheet itself; here, there is no such
// ancestor, so this component supplies its own `relative` wrapper around
// it so the highlight stays scoped to this one row's drop target instead
// of covering the whole page.
//
// Deliberately calls `deliverPortalDeliverable`
// (lib/actions/portal-deliverables.ts), never `uploadAttachment` — see
// that action's own header comment for why the generic action cannot be
// reused for a client caller at all (`canWrite` unconditionally rejects
// the `client` role).
import { useRef, useState, useTransition } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { deliverPortalDeliverable } from "@/lib/actions/portal-deliverables";
import { validateAttachmentFile } from "@/lib/tasks/validate-attachment-file";
import { Button } from "@/components/ui/button";
import { AttachmentDropzone } from "@/components/task/attachment-dropzone";
import { cn } from "@/lib/utils";

export function DeliverableUpload({
  deliverableId,
  onDelivered,
}: {
  deliverableId: string;
  /** Called after a successful upload so the row can flip to its
   * "waiting for us to check it" state immediately, without a full page
   * reload. */
  onDelivered: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);

  function sendFile(file: File) {
    const validation = validateAttachmentFile(file);
    if (!validation.ok) {
      toast.error(validation.reason);
      return;
    }

    const formData = new FormData();
    formData.set("deliverableId", deliverableId);
    formData.set("file", file);

    startTransition(async () => {
      const result = await deliverPortalDeliverable(formData);
      if (result.ok) {
        toast.success("Sent. We'll check it and let you know.");
        onDelivered();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="relative" data-drag-active={isDragActive || undefined}>
      <AttachmentDropzone
        disabled={isPending}
        onFilesDropped={(files) => {
          setIsDragActive(false);
          const [first] = files;
          if (first) sendFile(first);
        }}
      >
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-mini",
            isPending && "opacity-60",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            disabled={isPending}
            onChange={(event) => {
              const [first] = event.target.files ?? [];
              if (first) sendFile(first);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Paperclip className="size-4" aria-hidden="true" />
            )}
            Send file
          </Button>
          <span className="text-muted-foreground">or drag a file here</span>
        </div>
      </AttachmentDropzone>
    </div>
  );
}
