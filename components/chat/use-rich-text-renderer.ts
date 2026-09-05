"use client";

// Faza A (docs/chat-slack-parity-plan.md, BUG-1): shared lazy-loader for
// `RichTextRenderer` (components/editor/rich-text-editor.tsx), used by
// every read-only chat surface (message-list.tsx, thread-panel.tsx) that
// needs to render a message's `body_json` as actual rich text instead of
// `extractPlainText`'s flattened string.
//
// Same "client-only, lazy `import()` inside an effect" pattern
// message-composer.tsx and comment-list.tsx already establish for this
// exact module -- keeps every caller (including a `renderToStaticMarkup`
// unit test with no DOM/effects, e.g. tests/unit/f083-chat-delete-
// confirm.test.tsx) rendering its own plain-text fallback until this
// resolves, rather than needing `next/dynamic`'s SSR-disabling wrapper at
// every call site.
import { useEffect, useState } from "react";
import type { JSONContent } from "@tiptap/react";

type MentionSuggestionItem = { id: string; label: string };

export type RichTextRendererComponent = (props: {
  content?: JSONContent | null;
  className?: string;
  "aria-label"?: string;
  mentionSuggestions?: MentionSuggestionItem[];
}) => React.ReactElement | null;

export function useRichTextRenderer(): RichTextRendererComponent | null {
  const [Renderer, setRenderer] = useState<RichTextRendererComponent | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    import("@/components/editor/rich-text-editor").then((imported) => {
      if (!cancelled) {
        setRenderer(() => imported.RichTextRenderer);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return Renderer;
}
