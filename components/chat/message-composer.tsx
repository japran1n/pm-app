"use client";

// F4 (docs/advanced-chat-plan.md): message composer.
//
// F13 (docs/advanced-chat-plan.md, @-mentions u chat-u): upgraded off the
// plain <textarea> per that feature's explicit "preduslov" step 1 --
// `message-composer.tsx` now uses the shared Tiptap editor
// (components/editor/rich-text-editor.tsx) with the same Mention
// extension task comments/descriptions already use, rather than a
// plain-text `@name` regex parser. `onSend` now takes a Tiptap
// `JSONContent` document instead of a plain string, matching
// `sendMessage`'s existing signature (F3 already accepted `bodyJson:
// JSONContent` -- only the composer itself was still plain text).
//
// Client-only by construction (rich-text-editor.tsx's own doc comment):
// lazy-loaded via a plain dynamic `import()` inside an effect, same
// pattern components/task/comment-list.tsx already established for this
// exact module, so this component (and any unit test rendering it via
// `renderToStaticMarkup`, no window) still degrades to a plain textarea
// before that effect ever runs, rather than needing `next/dynamic`'s
// SSR-disabling wrapper at this call site.
import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2, SendHorizonal, Paperclip, X } from "lucide-react";
import type { JSONContent } from "@tiptap/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { docFromPlainText } from "@/lib/comments/rich-text";
import {
  uploadChatAttachment,
  removePendingChatAttachment,
} from "@/lib/actions/chat-attachments";

type MentionSuggestionItem = { id: string; label: string };

type RichTextEditorModule = {
  RichTextEditor: (props: {
    content?: JSONContent | null;
    onChange?: (content: JSONContent) => void;
    disabled?: boolean;
    placeholder?: string;
    "aria-label"?: string;
    className?: string;
    mentionSuggestions?: MentionSuggestionItem[];
  }) => React.ReactElement | null;
};

function useRichTextModule(): RichTextEditorModule | null {
  const [module, setModule] = useState<RichTextEditorModule | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@/components/editor/rich-text-editor").then((imported) => {
      if (!cancelled) {
        setModule({ RichTextEditor: imported.RichTextEditor });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return module;
}

const EMPTY_DOC: JSONContent = { type: "doc", content: [] };

function isEmptyDoc(doc: JSONContent): boolean {
  return !Array.isArray(doc.content) || doc.content.length === 0;
}

type PendingAttachment = { id: string; fileName: string; uploading?: boolean };

export function MessageComposer({
  onSend,
  onTyping,
  disabled,
  mentionSuggestions,
  channelId,
}: {
  onSend: (bodyJson: JSONContent, attachmentIds?: string[]) => Promise<{ ok: boolean; error?: string }>;
  onTyping?: () => void;
  disabled?: boolean;
  mentionSuggestions?: MentionSuggestionItem[];
  channelId?: string;
}) {
  const richText = useRichTextModule();
  const [plainValue, setPlainValue] = useState("");
  const [richValue, setRichValue] = useState<JSONContent>(EMPTY_DOC);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const useRichEditor = !!richText && mentionSuggestions !== undefined;
  const canSubmit = (useRichEditor ? !isEmptyDoc(richValue) : !!plainValue.trim()) || pendingAttachments.length > 0;
  const isUploading = pendingAttachments.some((a) => a.uploading);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !channelId) return;
    e.target.value = "";
    const tempId = crypto.randomUUID();
    setPendingAttachments((prev) => [...prev, { id: tempId, fileName: file.name, uploading: true }]);
    const formData = new FormData();
    formData.set("channelId", channelId);
    formData.set("file", file);
    const result = await uploadChatAttachment(formData);
    if (result.ok) {
      setPendingAttachments((prev) =>
        prev.map((a) => a.id === tempId ? { id: result.data.id, fileName: file.name } : a)
      );
    } else {
      setPendingAttachments((prev) => prev.filter((a) => a.id !== tempId));
      setError(result.error);
    }
  }

  async function removeAttachment(attachmentId: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    await removePendingChatAttachment(attachmentId);
  }

  function submit() {
    if (!canSubmit || isPending || disabled || isUploading) return;

    const bodyJson = useRichEditor ? richValue : docFromPlainText(plainValue.trim() || " ");
    const attachmentIds = pendingAttachments.map((a) => a.id);

    setError(null);
    startTransition(async () => {
      const result = await onSend(bodyJson, attachmentIds);
      if (result.ok) {
        setPlainValue("");
        setRichValue(EMPTY_DOC);
        setPendingAttachments([]);
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="border-t p-3">
      {pendingAttachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {pendingAttachments.map((a) => (
            <div key={a.id} className="flex items-center gap-1 rounded border border-border bg-muted px-2 py-1 text-xs">
              <span className="max-w-32 truncate">{a.fileName}</span>
              {a.uploading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <button type="button" onClick={() => void removeAttachment(a.id)} className="text-muted-foreground hover:text-foreground">
                  <X className="size-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        {useRichEditor ? (
          <div
            className="min-h-10 max-h-40 flex-1 overflow-y-auto"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          >
            <richText.RichTextEditor
              content={richValue}
              onChange={(content) => {
                setRichValue(content);
                onTyping?.();
              }}
              disabled={disabled || isPending}
              placeholder="Message..."
              aria-label="Message"
              mentionSuggestions={mentionSuggestions}
            />
          </div>
        ) : (
          <Textarea
            value={plainValue}
            onChange={(e) => {
              setPlainValue(e.target.value);
              onTyping?.();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Message..."
            aria-label="Message"
            disabled={disabled || isPending}
            className="min-h-10 max-h-40 flex-1 resize-none"
          />
        )}
        {channelId && (
          <>
            <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => void handleFileChange(e)} />
            <Button type="button" size="icon" variant="ghost" onClick={() => fileInputRef.current?.click()} disabled={disabled || isPending || isUploading} aria-label="Attach file">
              <Paperclip className="size-4" />
            </Button>
          </>
        )}
        <Button
          type="button"
          size="icon"
          onClick={submit}
          disabled={disabled || isPending || !canSubmit || isUploading}
          aria-label="Send message"
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <SendHorizonal className="size-4" />
          )}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}
