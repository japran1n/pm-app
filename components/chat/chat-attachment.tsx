"use client";

// Faza A (docs/chat-slack-parity-plan.md, BUG-2): renders one message
// attachment -- an inline image (with a lightbox-via-new-tab click) or a
// generic file chip. Shared by message-list.tsx (top-level messages) and
// thread-panel.tsx (thread replies) so the two surfaces can never diverge
// in how an attachment is displayed.
//
// Two ways an attachment reaches this component:
//   1. Just sent in this session (chat-messages.ts's sendMessage already
//      minted a signed URL for the immediate optimistic append) --
//      `signedUrl` is already set, no fetch needed.
//   2. Loaded from a page fetch (lib/queries/chat.ts's
//      getMessageAttachments) -- only `storagePath`-shaped metadata is
//      known; this component mints its own signed URL on mount via the
//      existing getChatAttachmentSignedUrl Server Action (already
//      membership-checked server-side), same "sign on demand, never
//      persist/reuse" convention lib/actions/attachments.ts documents for
//      task attachments.
import { useEffect, useState } from "react";
import { Paperclip, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { getChatAttachmentSignedUrl } from "@/lib/actions/chat-attachments";

export type ChatAttachmentData = {
  id: string;
  fileName: string;
  mimeType?: string | null;
  fileSize?: number | null;
  /** Already-minted signed URL (path 1 above). */
  signedUrl?: string | null;
};

function formatFileSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatAttachment({ attachment }: { attachment: ChatAttachmentData }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(
    attachment.signedUrl ?? null,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (attachment.signedUrl || failed) return;
    let cancelled = false;
    void getChatAttachmentSignedUrl(attachment.id).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setSignedUrl(result.signedUrl);
      } else {
        setFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.id, attachment.signedUrl]);

  const isImage = attachment.mimeType?.startsWith("image/") ?? false;
  const sizeLabel = formatFileSize(attachment.fileSize);

  if (isImage && signedUrl) {
    return (
      <a
        href={signedUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block max-w-64 overflow-hidden rounded-md border border-border"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a
            time-limited signed URL from Supabase Storage, not a static
            asset next/image can optimise/cache. */}
        <img
          src={signedUrl}
          alt={attachment.fileName}
          className="max-h-64 w-auto object-contain"
        />
      </a>
    );
  }

  return (
    <a
      href={signedUrl ?? undefined}
      target={signedUrl ? "_blank" : undefined}
      rel="noopener noreferrer"
      aria-disabled={!signedUrl}
      className={cn(
        "flex max-w-64 items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-micro",
        signedUrl ? "hover:bg-muted" : "pointer-events-none opacity-70",
      )}
    >
      {!signedUrl && !failed ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
      {sizeLabel && (
        <span className="shrink-0 text-muted-foreground">{sizeLabel}</span>
      )}
    </a>
  );
}
