// GAP3-03: rich-text bodies (comments, chat) are bounded by size, depth,
// node count and plain-text length; extractPlainText never recurses.
import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/react";

import {
  checkRichTextLimits,
  extractPlainText,
  RICH_TEXT_MAX_DEPTH,
} from "@/lib/comments/rich-text";
import { commentBodyJsonSchema } from "@/lib/validation/comments";
import { messageBodyJsonSchema, sendMessageSchema } from "@/lib/validation/chat";

function nested(depth: number): JSONContent {
  let node: JSONContent = { type: "text", text: "deep" };
  for (let i = 0; i < depth; i += 1) {
    node = { type: "blockquote", content: [node] };
  }
  return { type: "doc", content: [node] };
}

function paragraphDoc(text: string, count = 1): JSONContent {
  return {
    type: "doc",
    content: Array.from({ length: count }, () => ({
      type: "paragraph",
      content: [{ type: "text", text }],
    })),
  };
}

describe("extractPlainText (GAP3-03)", () => {
  it("does not throw on a 3,000-deep document", () => {
    expect(() => extractPlainText(nested(3000))).not.toThrow();
  });

  it("does not throw on a 100,000-deep document", () => {
    expect(() => extractPlainText(nested(100_000))).not.toThrow();
  });

  it("keeps the previous projection for normal documents", () => {
    const doc: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hi " },
            { type: "mention", attrs: { id: "u1" } },
            { type: "hardBreak" },
            { type: "text", text: "line 2" },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "b" }] }] },
          ],
        },
      ],
    };
    expect(extractPlainText(doc)).toBe("Hi @u1\nline 2\n\nab");
    expect(extractPlainText(doc, () => "Alice")).toBe("Hi @Alice\nline 2\n\nab");
  });

  it("still reads text within the depth bound", () => {
    expect(extractPlainText(nested(RICH_TEXT_MAX_DEPTH - 3))).toBe("deep");
  });
});

describe("checkRichTextLimits (GAP3-03)", () => {
  it("accepts a normal document", () => {
    expect(checkRichTextLimits(paragraphDoc("hello")).ok).toBe(true);
  });

  it("rejects excessive depth", () => {
    expect(checkRichTextLimits(nested(3000))).toEqual({ ok: false, reason: "depth" });
  });

  it("rejects nested attrs bombs", () => {
    let attrs: Record<string, unknown> = { x: 1 };
    for (let i = 0; i < 5000; i += 1) attrs = { a: attrs };
    const doc = { type: "doc", content: [{ type: "paragraph", attrs }] };
    expect(checkRichTextLimits(doc).ok).toBe(false);
  });

  it("rejects oversize documents", () => {
    expect(checkRichTextLimits(paragraphDoc("x".repeat(300_000)))).toEqual({
      ok: false,
      reason: "bytes",
    });
  });

  it("rejects too many nodes", () => {
    expect(checkRichTextLimits(paragraphDoc("a", 30_000)).ok).toBe(false);
  });
});

describe("comment/chat body schemas (GAP3-03)", () => {
  it("reject a 4,000,000-char body smuggled through bodyJson", () => {
    const doc = paragraphDoc("x".repeat(4_000_000));
    expect(commentBodyJsonSchema.safeParse(doc).success).toBe(false);
    expect(messageBodyJsonSchema.safeParse(doc).success).toBe(false);
  });

  it("reject plain-text projections over 10,000 chars even when small in bytes", () => {
    const doc = paragraphDoc("x".repeat(10_001));
    const result = commentBodyJsonSchema.safeParse(doc);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/10000 characters/);
  });

  it("reject a deeply nested body", () => {
    expect(commentBodyJsonSchema.safeParse(nested(3000)).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({
        channelId: "00000000-0000-4000-8000-000000000001",
        bodyJson: nested(3000),
      }).success,
    ).toBe(false);
  });

  it("accept a normal body", () => {
    expect(commentBodyJsonSchema.safeParse(paragraphDoc("hello")).success).toBe(true);
    expect(messageBodyJsonSchema.safeParse(paragraphDoc("hello")).success).toBe(true);
  });
});
