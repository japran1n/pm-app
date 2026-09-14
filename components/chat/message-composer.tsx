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
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { docFromPlainText, extractPlainText, toPlainJson } from "@/lib/comments/rich-text";
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
    onEnterSubmit?: (content: JSONContent) => void;
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
const REQUEST_ATTACHMENT_ERROR = "Attachments can't be added to a request yet — send them as a message.";

// BUG FIX (empty/whitespace-only messages reaching the DB): the previous
// implementation only checked `doc.content.length === 0`, which is true for
// a genuinely empty Tiptap doc (`{ type: "doc", content: [] }`) but NOT for
// the far more common "user typed then deleted everything" / "user typed
// only spaces" case, where Tiptap still leaves a single empty (or
// whitespace-only) paragraph node behind — e.g.
// `{ type: "doc", content: [{ type: "paragraph" }] }` or
// `{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "   " }] }] }`.
// Both have `content.length === 1`, so the old check returned `false`
// (not empty) and let `submit()` send a message with a blank body straight
// to the server — this is the confirmed root cause of the empty messages
// found in the live DM thread. Reuse the same `extractPlainText` projection
// the server itself uses to compute `body_text`, so "empty" here means
// exactly what the server considers empty.
function isEmptyDoc(doc: JSONContent): boolean {
  if (!Array.isArray(doc.content) || doc.content.length === 0) return true;
  return extractPlainText(doc).length === 0;
}

type PendingAttachment = { id: string; fileName: string; uploading?: boolean };

export function MessageComposer({
  onSend,
  onTyping,
  disabled,
  mentionSuggestions,
  channelId,
  initialDraft,
  onFileRequest,
}: {
  onSend: (bodyJson: JSONContent, attachmentIds?: string[]) => Promise<{ ok: boolean; error?: string }>;
  onTyping?: () => void;
  disabled?: boolean;
  mentionSuggestions?: MentionSuggestionItem[];
  channelId?: string;
  // Paket E ("Piši nam"): plain-text draft (e.g. "@Name ") to prefill the
  // composer with on first render -- ChannelView's own initialMentionName
  // prop, already turned into "@Name " there. Deliberately plain text,
  // not a real Tiptap mention node: this only needs to land the cursor
  // after a name the sender can keep typing after, same "minimal
  // mechanism" the feature asked for, not a full mention-suggestion
  // auto-resolve on load.
  initialDraft?: string;
  // F007 (portal-simplify, AS-012/AS-013): when set, this composer -- the
  // portal's Messages page -- gains a "This is a request for new work"
  // checkbox. Only the portal Messages page passes this prop (see
  // ChannelView's own `onFileRequest` doc comment); every other caller of
  // this shared composer (staff chat, portal task-thread) leaves it
  // undefined and renders exactly as before -- no checkbox, no behaviour
  // change, per this feature's "no change to team-side" requirement.
  // Title is derived from the first line of the composed text and the full
  // text is kept as the description, per the clarified spec, since the
  // rich-text composer has no separate title field of its own.
  onFileRequest?: (payload: {
    title: string;
    body: string;
  }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const richText = useRichTextModule();
  const [plainValue, setPlainValue] = useState(initialDraft ?? "");
  const [richValue, setRichValue] = useState<JSONContent>(() =>
    initialDraft ? docFromPlainText(initialDraft) : EMPTY_DOC,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isRequest, setIsRequest] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  // F122: `RichTextEditor.onUpdate` fires (and applies Tiptap's own
  // autolink mark, WITH a real href) from inside the native "Enter"
  // keydown's own synchronous ProseMirror dispatch, which runs before the
  // React-synthetic `onKeyDown` below (attached via root-level delegation)
  // ever sees the same event. `submit()` used to read the `richValue`
  // React state directly, which is only guaranteed up to date as of the
  // last committed render — a plain function closure captured before this
  // keystroke's own state update has flushed. Mirroring every `onChange`
  // into a ref read synchronously by `submit()` means Enter always sends
  // the just-linked document, never a one-keystroke-stale one.
  const richValueRef = useRef<JSONContent>(
    initialDraft ? docFromPlainText(initialDraft) : EMPTY_DOC,
  );

  // Portal polish follow-up (F015 request-mode attachment blocking): the
  // "Attachments can't be added to a request yet" error is only ever true
  // while BOTH request mode is on AND attachments are still pending --
  // derived here (rather than cleared via a `useEffect` + `setState` pair,
  // which would trip this repo's `react-hooks/set-state-in-effect` rule)
  // so it disappears the instant either condition stops holding
  // (attachments removed, or request mode turned back off) instead of
  // lingering on screen describing a state that no longer exists.
  const displayedError =
    error === REQUEST_ATTACHMENT_ERROR && (!isRequest || pendingAttachments.length === 0)
      ? null
      : error;

  const useRichEditor = !!richText && mentionSuggestions !== undefined;
  const canSubmit = (useRichEditor ? !isEmptyDoc(richValue) : !!plainValue.trim()) || pendingAttachments.length > 0;
  const isUploading = pendingAttachments.some((a) => a.uploading);

  // Stable ref to the upload function so the capture-phase paste listener
  // (registered once) can always call the latest closure without being
  // re-registered every render.
  const uploadFileRef = useRef<(file: File) => Promise<void>>(async () => {});

  async function uploadFile(file: File) {
    if (!channelId) return;
    const tempId = crypto.randomUUID();
    setPendingAttachments((prev) => [...prev, { id: tempId, fileName: file.name, uploading: true }]);
    const formData = new FormData();
    formData.set("channelId", channelId);
    formData.set("file", file);
    const result = await uploadChatAttachment(formData);
    if (result.ok) {
      setPendingAttachments((prev) =>
        prev.map((a) => (a.id === tempId ? { id: result.data.id, fileName: file.name } : a)),
      );
    } else {
      setPendingAttachments((prev) => prev.filter((a) => a.id !== tempId));
      setError(result.error);
    }
  }
  // Keep the ref current every render so the paste listener always calls
  // the latest closure (with fresh channelId / state setters).
  useEffect(() => {
    uploadFileRef.current = uploadFile;
  });

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    await uploadFile(file);
  }

  // Registered in capture phase so it fires before Tiptap's own paste handler
  // can call stopPropagation and swallow the event.
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    function onPasteCapture(e: ClipboardEvent) {
      if (!channelId) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.kind === "file" && i.type.startsWith("image/"));
      if (!imageItem) return;
      const file = imageItem.getAsFile();
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      const ext = file.type.split("/")[1] ?? "png";
      const named = new File([file], `screenshot-${Date.now()}.${ext}`, { type: file.type });
      void uploadFileRef.current(named);
    }
    el.addEventListener("paste", onPasteCapture, true);
    return () => el.removeEventListener("paste", onPasteCapture, true);
    // channelId as dep: if it changes the listener re-registers with the new value
  }, [channelId]);

  async function removeAttachment(attachmentId: string) {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    await removePendingChatAttachment(attachmentId);
  }


  function submit() {
    if (isPending || disabled || isUploading) return;

    // Re-derive "is there anything to send" from the FRESHEST known
    // content (`richValueRef.current`, kept in sync by both `onChange` and
    // `onEnterSubmit` below) rather than trusting the `canSubmit` variable
    // captured in this render's closure -- `canSubmit` is only guaranteed
    // accurate as of the last completed render, and `submit()` itself can
    // run from a raw DOM-level event handler (`onEnterSubmit`, invoked
    // synchronously inside Tiptap's `handleKeyDown`, before React has had
    // a chance to re-render). This is also where an empty message (just
    // whitespace / Tiptap's empty-doc shape) is rejected outright: no
    // server action call, editor untouched, exactly per this bug's fix
    // requirement that an empty Enter/click is silently ignored.
    const hasContent = useRichEditor
      ? !isEmptyDoc(richValueRef.current)
      : !!plainValue.trim();
    const hasAttachments = pendingAttachments.length > 0;
    if (!hasContent && !hasAttachments) return;

    if (isRequest && onFileRequest) {
      // F015 (portal-simplify, AS-012): a request queued with attachments
      // would otherwise silently drop them -- client_requests has no
      // attachment concept of its own, and the ordinary onSend path
      // (which DOES persist chat attachments) is never reached from this
      // branch. Blocking (over silently carrying them into the message
      // path, or into the request's body as a note) is the option this
      // feature's spec picked -- an explicit, actionable error beats a
      // silent drop.
      if (pendingAttachments.length > 0) {
        setError(REQUEST_ATTACHMENT_ERROR);
        return;
      }

      // AS-012/AS-013: filing a request has no rich-formatting concept of
      // its own (client_requests is a plain title+body row), so this
      // branch never reaches the ordinary sendMessage/onSend path below --
      // only plain text is extracted and handed to the request action.
      // The title is the first line, the full text stays as the
      // body/description, per the clarified spec. `mentionSuggestions` is
      // reused (the same list the rich editor renders "@Name" pills from)
      // so a mention in a request resolves to the person's real name
      // here too, not the raw user id `extractPlainText`'s id-only
      // fallback would otherwise produce.
      const resolveLabel = (userId: string) =>
        mentionSuggestions?.find((m) => m.id === userId)?.label ?? null;
      const fullText = (
        useRichEditor
          ? extractPlainText(richValueRef.current, resolveLabel)
          : plainValue
      ).trim();
      if (!fullText) return;
      const firstLine = (fullText.split("\n")[0] ?? fullText).trim();
      const title = firstLine.slice(0, 200);
      const titleWasTruncated = firstLine.length > title.length;
      setError(null);
      startTransition(async () => {
        const result = await onFileRequest({ title, body: fullText });
        if (result.ok) {
          setPlainValue("");
          setRichValue(EMPTY_DOC);
          richValueRef.current = EMPTY_DOC;
          setIsRequest(false);
          toast.success(
            titleWasTruncated
              ? "Request sent — the title was shortened to fit the length limit."
              : "Request sent",
          );
        } else {
          setError(result.error ?? "Something went wrong. Please try again.");
        }
      });
      return;
    }

    // F123: `richValueRef.current` is Tiptap's live JSONContent, whose
    // nested `attrs` objects cross the sendMessage server-action boundary
    // as temporary client references rather than plain data (React RSC
    // behaviour) -- reading `.attrs.href` on the server then throws, and
    // before that read existed the href was simply lost silently. Apply
    // the same `toPlainJson` round-trip the comment composer and task
    // description editor already use, HERE on the client before the
    // value ever crosses the boundary -- doing it inside sendMessage
    // itself (as before) is too late, since serialisation has to happen
    // before, not after, the RSC boundary is crossed.
    const bodyJson = useRichEditor
      ? toPlainJson(richValueRef.current)
      : docFromPlainText(plainValue.trim() || " ");
    const attachmentIds = pendingAttachments.map((a) => a.id);

    setError(null);
    startTransition(async () => {
      const result = await onSend(bodyJson, attachmentIds);
      if (result.ok) {
        setPlainValue("");
        setRichValue(EMPTY_DOC);
        richValueRef.current = EMPTY_DOC;
        setPendingAttachments([]);
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div ref={composerRef} className="border-t p-3">
      {onFileRequest && (
        <label className="mb-2 flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={isRequest}
            onCheckedChange={(checked) => setIsRequest(checked === true)}
            disabled={disabled || isPending}
          />
          This is a request for new work
        </label>
      )}
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
              // F037/F038 (IME safety, narrowed): only suppress Enter for a
              // genuine IME candidate-commit, not for ordinary composing.
              // See rich-text-editor.tsx's own `handleKeyDown` for the full
              // rationale (kept in lockstep with that guard, though it never
              // actually fires in practice — see the comment there for why).
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !(e.nativeEvent.isComposing && e.keyCode === 229)
              ) {
                e.preventDefault();
                submit();
              }
            }}
          >
            <richText.RichTextEditor
              content={richValue}
              onChange={(content) => {
                richValueRef.current = content;
                setRichValue(content);
                onTyping?.();
              }}
              disabled={disabled || isPending}
              placeholder="Message..."
              aria-label="Message"
              mentionSuggestions={mentionSuggestions}
              onEnterSubmit={(content) => {
                // Fresh straight from ProseMirror's own state at the exact
                // moment Enter was pressed -- see rich-text-editor.tsx's
                // `onEnterSubmit` doc comment. Mirror it into the ref
                // `submit()` reads so both paths (Enter and the Send
                // button) always send/clear the same, current content.
                richValueRef.current = content;
                setRichValue(content);
                submit();
              }}
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
              // F037/F038 (IME safety, narrowed): Android soft keyboards
              // (GBoard, Samsung) set `isComposing === true` during
              // ordinary Latin typing, not just genuine CJK candidate
              // selection — the original guard here (suppress whenever
              // `isComposing` is true) broke Enter-to-send for those users
              // on the plain-textarea path. `keyCode === 229` is the
              // signal browsers send specifically for an IME candidate
              // commit, so requiring BOTH narrows the guard to that case.
              // Tradeoff: a small number of older/less-common IME+browser
              // combinations that set `isComposing` without `keyCode 229`
              // on commit will now submit prematurely — accepted because
              // (a) 229 is well-supported across current Chrome/Safari/
              // Firefox IME implementations for the mainstream CJK IMEs,
              // and (b) an Android user losing Enter-to-send entirely on a
              // shipped, real-user feature is worse than a rare
              // premature-submit edge case on an already-degraded IME path.
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !(e.nativeEvent.isComposing && e.keyCode === 229)
              ) {
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
      {displayedError && <p className="mt-1 text-xs text-destructive">{displayedError}</p>}
    </div>
  );
}
