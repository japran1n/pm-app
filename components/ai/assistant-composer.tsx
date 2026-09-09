"use client";

// F012: the docs assistant's composer. Replaces F009's placeholder
// (`assistant-sidebar-composer-placeholder`) in components/ai/
// assistant-sidebar.tsx. Owns BOTH the enabled input path and the
// AS-071 "no API key configured" message — the whole composer region is
// this component's DOM slot now, since AS-071 is assigned to this
// feature too (F009 only had to prove the no-key branch existed; this
// feature owns its real copy/styling end to end).
//
// `send`/`stop`/`isStreaming` are the SAME `useDocAssistant(...)` values
// already read once in assistant-sidebar.tsx (per F009's handoff note:
// don't call the hook a second time, it owns its own fetch/
// AbortController and two instances would double-request). This
// component is a pure, controlled leaf — no `useDocAssistant` import here.
//
// Enter-to-submit convention: components/chat/message-composer.tsx (this
// app's one other chat composer) was read before writing this file, per
// the spec's explicit instruction. It has exactly ONE Enter convention —
// Enter submits, Shift+Enter inserts a newline — applied unconditionally,
// with NO viewport- or touch-specific branch anywhere (grepped the whole
// repo for `pointer: coarse` / `ontouchstart` / `isTouchDevice` /
// `useMediaQuery` in that file and its rich-text editor dependency:
// nothing). There is therefore no existing "Enter inserts a newline on
// mobile" mechanism to reuse — inventing one here would be the SECOND
// convention for the same gesture the spec explicitly warns against. This
// composer matches the chat composer's one real convention exactly:
// Enter (no modifiers, not Shift) submits; Shift+Enter is a newline;
// behaviour does not change with viewport width or pointer type. Flagged
// under Out-of-scope work needed in the F012 handoff.
import { useRef, useState } from "react";
import { SendHorizonal, Square } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Mirrors lib/ai/client.ts's `DOCS_MODEL` ("claude-opus-5") as a
// human-readable label. That file is explicitly server-only (its own
// header comment: "Do not import this from client components or the
// browser bundle" — it lazily constructs an Anthropic SDK client), so a
// display-only copy lives here rather than importing it. See handoff for
// the follow-up if the two ever need to be kept in lockstep by a shared,
// client-safe constants module instead.
const MODEL_DISPLAY_NAME = "Claude Opus 5";

export interface AssistantComposerUsage {
  inputTokens: number;
  outputTokens: number;
}

export function AssistantComposer({
  hasApiKey,
  isStreaming,
  send,
  stop,
  usage,
}: {
  hasApiKey: boolean;
  isStreaming: boolean;
  send: (text: string) => void;
  stop: () => void;
  /**
   * Cumulative token usage for the thread, if the caller has it. Not
   * currently wired anywhere — `useDocAssistant` (lib/ai/use-doc-
   * assistant.ts) parses `{"t":"usage",...}` events off the wire but
   * discards them (a no-op case in that hook's `applyEvent` switch) rather
   * than accumulating and exposing a running total. That hook is outside
   * this feature's Touches list, so this prop exists so the meta row can
   * show a real figure the moment a future feature wires it through,
   * without this component changing shape. See handoff Out-of-scope.
   */
  usage?: AssistantComposerUsage | null;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const trimmed = value.trim();
  const canSubmit = hasApiKey && !isStreaming && trimmed.length > 0;

  function submit() {
    if (!canSubmit) return;
    send(trimmed);
    setValue("");
    // Re-focus after clearing so the user can keep typing the next turn
    // without reaching for the mouse — same "stay in flow" intent the
    // chat composer's own submit path has (it clears state and leaves
    // focus where it was, since Textarea/RichTextEditor never blur on
    // submit there either).
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Matches components/chat/message-composer.tsx's plain-Textarea path
    // exactly: Enter (no Shift) submits, Shift+Enter is a newline. See
    // this file's header comment for why no touch/viewport branch exists.
    //
    // F037 (IME safety): an IME candidate-commit Enter must not submit —
    // `isComposing` is the standard signal; `keyCode === 229` is the
    // historical Safari/older-Chrome fallback for the same condition.
    // Without this, a CJK user pressing Enter to commit a candidate sends
    // raw partial text and the textarea clears mid-composition.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      submit();
    }
  }

  if (!hasApiKey) {
    // AS-071: a configuration state, not a failure — deliberately the
    // same neutral `bg-muted`/`text-muted-foreground` pair (not
    // `destructive`) F009 established for this exact message, so it
    // reads as calm/deliberate rather than broken. This is genuinely the
    // state a developer sees locally (no ANTHROPIC_API_KEY in this
    // worktree), so it was hand-checked, not just unit-tested.
    return (
      <p
        className="rounded-md bg-muted px-2.5 py-2 text-mini text-muted-foreground"
        data-testid="assistant-composer-no-api-key"
      >
        The docs assistant isn&apos;t configured for this environment yet —
        an administrator needs to set an API key before it can respond.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5" data-testid="assistant-composer">
      <div className="flex items-end gap-2">
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          // F036 (minor fold-in): `disabled` used to drop focus to
          // `<body>` on every turn (a `disabled` form control is
          // unfocusable, and this textarea holds focus most of the time
          // a message is in flight) — keyboard users had to re-tab to
          // reach Stop every single turn. `readOnly` blocks edits the
          // same way without forcing a blur; Enter-to-submit is already
          // a no-op while streaming via `canSubmit` below.
          readOnly={isStreaming}
          placeholder="Ask about this workspace's docs…"
          aria-label="Message the docs assistant"
          data-testid="assistant-composer-input"
          rows={1}
          // Auto-grow: the shared Textarea primitive already ships
          // `field-sizing-content` (see components/ui/textarea.tsx) —
          // the same mechanism components/chat/message-composer.tsx's
          // plain-Textarea path relies on for its own min/max-height
          // pair, no manual JS resize handler needed. Capped at ~6 rows
          // (9rem, text-mini's line-height) then scrolls internally
          // rather than growing the whole panel.
          className="max-h-[9rem] min-h-9 flex-1 resize-none overflow-y-auto py-1.5"
        />
        {isStreaming ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={stop}
            aria-label="Stop generating"
            data-testid="assistant-composer-stop"
          >
            <Square className="size-3.5" aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={submit}
            disabled={!canSubmit}
            aria-label="Send message"
            data-testid="assistant-composer-send"
          >
            <SendHorizonal className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Quiet meta row: model name + running usage, when known. Internal
          separator uses --line-row (this is a row within the composer
          region, not a panel-level border) per the two-family rule.
          `--text-quaternary` is the token this row is documented for in
          CLAUDE.md, but — per F009's own finding, confirmed again here —
          it has no Tailwind utility wired up anywhere in app/globals.css,
          so `text-muted-foreground` is used instead of inventing an
          unwired class, following F009's substitution exactly. */}
      <div
        className="flex items-center justify-between border-t border-line-row pt-1.5 text-micro text-muted-foreground"
        data-testid="assistant-composer-meta"
      >
        <span data-testid="assistant-composer-model">{MODEL_DISPLAY_NAME}</span>
        {usage && (
          <span data-testid="assistant-composer-usage">
            {usage.inputTokens + usage.outputTokens} tokens
          </span>
        )}
      </div>
    </div>
  );
}
