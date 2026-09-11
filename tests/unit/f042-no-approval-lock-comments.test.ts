// F042 (AS-170, AS-171, AS-172): the Architecture board is scoped to
// intentionally exclude an approval step, a read-only "locked" state, and
// commenting. This is a scope-boundary guard, not a behaviour test -- it
// reads the actual component source for board.tsx, page-column.tsx,
// section-card.tsx and client-board.tsx (the full board surface, team and
// portal) and asserts none of them ever grew any of these three features.
// Source-text inspection, not a render, because the thing under test is
// literally "this code was never written" -- there is no DOM state to
// assert against for a feature that doesn't exist, and rendering these
// client components would require mocking the full dnd-kit/next/navigation
// stack for no behavioural payoff over reading the file.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const componentDir = path.join(process.cwd(), "components", "architecture");

const files = [
  "board.tsx",
  "page-column.tsx",
  "section-card.tsx",
  "client-board.tsx",
].map((name) => ({
  name,
  source: readFileSync(path.join(componentDir, name), "utf8"),
}));

describe("F042: architecture board has no approval, locking, or comment surface", () => {
  it("test_AS_170_no_approval_requests_reference_or_approve_button", () => {
    for (const file of files) {
      expect(file.source.toLowerCase()).not.toContain("approval_request");
      expect(file.source.toLowerCase()).not.toContain("approve");
    }
  });

  it("test_AS_171_no_locked_state_that_makes_the_board_read_only_as_a_result_of_an_event", () => {
    // client-board.tsx's own doc comment legitimately describes itself as
    // "read-only" -- that's a permanent property of the portal view (it
    // never had drag/edit affordances to begin with), not a board that
    // *becomes* read-only as the result of some event (AS-171's actual
    // scope). What AS-171 rules out is a locking mechanism/state, so this
    // checks for that specifically rather than the descriptive phrase.
    for (const file of files) {
      const lower = file.source.toLowerCase();
      expect(lower).not.toContain("locked");
      expect(lower).not.toContain("is_locked");
      expect(lower).not.toContain("lock the board");
    }
  });

  it("test_AS_172_no_comment_ui_or_comment_data_reference", () => {
    // "comment" appears innocuously in a couple of doc-comments here
    // ("doc comment", "comment for how it reconciles..."), which are
    // meta-references to JS comments, not a commenting feature -- strip
    // those known phrases before asserting the word is absent entirely,
    // so a genuine comment-thread/comment-input feature still trips this.
    for (const file of files) {
      const lower = file.source
        .toLowerCase()
        .replace(/doc comment/g, "")
        .replace(/\/\/ comment for how/g, "");
      expect(lower).not.toContain("comment");
    }
  });
});
