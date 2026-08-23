// F308 (FU-12 item 3, AS-373): lib/comments/rich-text.ts's extractPlainText
// must project a mention node's resolved label into plain text so a
// mention-only comment ("@Alice", no other words) has non-empty plain
// text and can actually be posted — before this fix, a mention node
// contributed nothing to the projection and the composer's
// empty-comment guard silently blocked submission.

import { describe, expect, it } from "vitest";
import { docFromPlainText, extractPlainText } from "@/lib/comments/rich-text";

function mentionOnlyDoc(userId: string) {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "mention", attrs: { id: userId } }],
      },
    ],
  };
}

describe("extractPlainText (AS-373)", () => {
  it("test_AS_373_mention_only_comment_projects_non_empty_text", () => {
    const doc = mentionOnlyDoc("user-1");
    expect(extractPlainText(doc)).not.toBe("");
  });

  it("test_AS_373_mention_only_comment_uses_resolved_label_when_given", () => {
    const doc = mentionOnlyDoc("user-1");
    const resolve = (id: string) => (id === "user-1" ? "Alice" : null);
    expect(extractPlainText(doc, resolve)).toBe("@Alice");
  });

  it("test_AS_373_mention_only_comment_falls_back_to_id_without_resolver", () => {
    const doc = mentionOnlyDoc("user-1");
    expect(extractPlainText(doc)).toBe("@user-1");
  });

  it("test_AS_373_mention_plus_text_projects_both", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: "user-1" } },
            { type: "text", text: " thanks!" },
          ],
        },
      ],
    };
    const resolve = (id: string) => (id === "user-1" ? "Alice" : null);
    expect(extractPlainText(doc, resolve)).toBe("@Alice thanks!");
  });

  it("plain text still round-trips unchanged (no regression)", () => {
    const doc = docFromPlainText("hello world");
    expect(extractPlainText(doc)).toBe("hello world");
  });

  it("empty doc still projects to empty string (no regression)", () => {
    expect(extractPlainText(docFromPlainText(""))).toBe("");
  });
});
