"use client";

// F010: message thread rendering for the docs assistant sidebar
// (components/ai/assistant-sidebar.tsx's thread region — replaces the
// `assistant-sidebar-message-list-placeholder` div F009 left in place).
//
// Rendering rules (see this feature's spec):
// - User turns: a subtle raised bubble, right-aligned.
// - Assistant turns: plain text on the panel ground, no bubble — the
//   assistant is this panel's dominant voice, and wrapping it in a bubble
//   would make the whole thread read as noise.
// - Assistant text is markdown. Reused the SAME renderer the docs feature
//   already uses rather than adding a dependency: `tiptap-markdown`'s
//   `Markdown` extension (see components/docs/markdown-editor.tsx's own
//   header comment for why that package, not `@tiptap/extension-markdown`,
//   is the real one). A non-editable `useEditor` instance with that
//   extension renders the same markdown -> ProseMirror doc -> HTML path
//   the editor uses for editing, just with `editable: false` and no
//   toolbar/autosave wiring.
// - Auto-scroll must not fight a user who has scrolled up to read
//   something earlier in a long streaming answer: it only sticks to the
//   bottom while the user is already within ~40px of it, and offers a
//   "jump to latest" affordance otherwise (see `useStickToBottom` below).
// - `aria-live="polite"` on the thread container (AS-062: progressive
//   rendering) — not `assertive`, which would interrupt a screen reader
//   continuously as tokens stream in.

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { ArrowDown } from "lucide-react";

import { cn } from "@/lib/utils";
import type { AssistantMessage } from "@/lib/ai/use-doc-assistant";

/** How close to the bottom (px) counts as "already at the bottom". */
const STICK_THRESHOLD_PX = 40;

/**
 * Renders one assistant turn's markdown text using the same
 * `tiptap-markdown` extension the doc editor uses to serialize
 * Markdown <-> ProseMirror, just read-only. A fresh editor instance is
 * created per message (keyed by `message.id` by the caller), and its
 * content is kept in sync as `text` grows across streamed deltas.
 */
function AssistantMarkdown({ text }: { text: string }) {
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: text,
    editable: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        // F038: no `prose-invert` here — `design/linear`'s
        // `bf6b0b69` maps `--tw-prose-*` tokens to the dark workspace
        // palette globally (`:root:not([data-surface="portal"])`), which
        // is meant to work WITHOUT a per-call-site invert. Adding
        // `prose-invert` at the element level would set its own
        // `--tw-prose-*` custom properties on this node, which win over
        // the `:root` mapping on cascade/specificity grounds and silently
        // opt this renderer back out of it. Correct rendering here
        // depends on `bf6b0b69` landing when the branches merge.
        class: "prose prose-sm max-w-none",
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    // F037: previously guarded with a `getMarkdown() !== text` check
    // before calling `setContent` — removed. That guard called a full
    // markdown *serialise* (getMarkdown) then a full *re-parse*
    // (setContent) on every streamed token regardless, because markdown
    // serialisation is not identity-preserving (e.g. `*em*` round-trips
    // to `_em_`), so `current !== text` was true on almost every call —
    // the guard rarely actually skipped the update it existed to avoid.
    // The M2 review measured ~3.2 MB round-tripped this way for a 4 KB
    // streamed answer across 400 deltas. `setContent` is unconditional
    // now; this effect already only re-runs when `text` itself changed.
    editor.commands.setContent(text, { emitUpdate: false });
  }, [editor, text]);

  if (!editor) return null;

  return <EditorContent editor={editor} />;
}

/**
 * Tracks whether the thread's scroll container is "stuck" to the bottom
 * (within `STICK_THRESHOLD_PX`), and auto-scrolls to the bottom on new
 * content ONLY while stuck. Once the user scrolls up past the threshold,
 * new content (including further streamed deltas) no longer yanks the
 * view — `isStuck === false` drives the "jump to latest" affordance
 * instead.
 */
function useStickToBottom<T extends HTMLElement>(
  dependency: unknown,
): {
  containerRef: React.RefObject<T | null>;
  isStuck: boolean;
  scrollToBottom: () => void;
} {
  const containerRef = useRef<T | null>(null);
  const [isStuck, setIsStuck] = useState(true);

  function scrollToBottom() {
    const el = containerRef.current;
    if (!el) return;
    // F037: `scrollHeight` alone overshoots by `clientHeight` — browsers
    // clamp so this was harmless in practice, but the correct target for
    // "scrolled to the bottom" is `scrollHeight - clientHeight`.
    el.scrollTop = el.scrollHeight - el.clientHeight;
    setIsStuck(true);
  }

  // Re-evaluate stuck-ness whenever the user scrolls.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function handleScroll() {
      const node = containerRef.current;
      if (!node) return;
      const distanceFromBottom =
        node.scrollHeight - node.scrollTop - node.clientHeight;
      setIsStuck(distanceFromBottom <= STICK_THRESHOLD_PX);
    }

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // New content arrived (dependency changed): only follow it to the
  // bottom if the user was already there.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isStuck) return;
    // F037: see `scrollToBottom` above for why this is
    // `scrollHeight - clientHeight`, not bare `scrollHeight`.
    el.scrollTop = el.scrollHeight - el.clientHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dependency]);

  return { containerRef, isStuck, scrollToBottom };
}

export function AssistantThread({
  messages,
  trailing,
}: {
  messages: AssistantMessage[];
  /**
   * F036 (fixes B5/M2-SCRUTINY.md): tool-call cards and the turn error
   * message used to be siblings of this scroll container in
   * assistant-sidebar.tsx, in an OUTER `<div>` with no `overflow` class
   * of its own — unshrinkable content there overflowed the whole `aside`,
   * painting over the composer. Rendered here instead, inside this
   * component's own `overflow-y-auto`/`aria-live` region, so they scroll
   * WITH the thread (this is genuinely this panel's one scroll region,
   * not two competing ones) and are announced the same way streamed text
   * already is (the other fold-in minor this same feature addresses).
   */
  trailing?: React.ReactNode;
}) {
  // Re-runs the "stick to bottom" effect whenever the total rendered text
  // length changes (covers both a new message being appended and an
  // existing streamed message growing token by token).
  const contentLength = messages.reduce((sum, m) => sum + m.text.length, 0);
  const { containerRef, isStuck, scrollToBottom } = useStickToBottom<HTMLDivElement>(
    `${messages.length}:${contentLength}`,
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        role="log"
        aria-live="polite"
        aria-label="Assistant conversation"
        data-testid="assistant-thread"
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto"
      >
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="flex justify-end">
              <p
                data-testid="assistant-thread-user-bubble"
                className="max-w-[85%] rounded-lg bg-muted px-3 py-1.5 text-mini font-medium text-foreground"
              >
                {message.text}
              </p>
            </div>
          ) : (
            <div
              key={message.id}
              data-testid="assistant-thread-assistant-turn"
              className="text-mini text-foreground"
            >
              <AssistantMarkdown text={message.text} />
            </div>
          ),
        )}
        {trailing}
      </div>

      {!isStuck && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          data-testid="assistant-thread-jump-to-latest"
          className={cn(
            "absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-micro font-medium text-foreground outline-none",
            "hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          )}
        >
          <ArrowDown className="size-3" aria-hidden="true" />
          Jump to latest
        </button>
      )}
    </div>
  );
}

export default AssistantThread;
