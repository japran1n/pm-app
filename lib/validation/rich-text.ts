import { z } from "zod";
import type { JSONContent } from "@tiptap/react";

import {
  checkRichTextLimits,
  extractPlainText,
} from "@/lib/comments/rich-text";

// GAP3-03 (audit 2026-09-24): the shared, bounded structural schema for a
// client-supplied Tiptap document (comment bodies, chat messages). Still
// NOT the rendering allow-list (that stays in
// components/editor/rich-text-editor.tsx's sanitiseDocument) — this only
// bounds what may be persisted:
//   - top-level shape `{ type: "doc", content?: [] }`;
//   - serialised size / nesting depth / node count (checkRichTextLimits,
//     iterative — a hostile depth cannot overflow the stack);
//   - the plain-text projection's length (`maxChars`), so the text cap
//     cannot be bypassed by sending content only in the document.
export function boundedRichTextDocSchema(maxChars: number, label: string) {
  return z
    .object({
      type: z.literal("doc"),
      content: z.array(z.unknown()).optional(),
    })
    .passthrough()
    .superRefine((doc, ctx) => {
      const limits = checkRichTextLimits(doc);
      if (!limits.ok) {
        ctx.addIssue({
          code: "custom",
          message:
            limits.reason === "depth"
              ? `${label} is nested too deeply.`
              : `${label} is too long.`,
        });
        return;
      }
      if (extractPlainText(doc as JSONContent).length > maxChars) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be ${maxChars} characters or fewer.`,
        });
      }
    });
}
