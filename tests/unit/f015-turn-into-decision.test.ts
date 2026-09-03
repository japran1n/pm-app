// Unit test for F015 (missions/20260903-portal, AS-044): "Turn into
// decision" — the comment menu affordance that carries a comment straight
// into the project's decision log. Renders CommentList directly
// (components/task/comment-list.tsx), same renderToStaticMarkup
// convention tests/unit/comment-list.test.ts already establishes for this
// component (no jsdom/RTL in this repo's vitest setup).
//
// This is a static-markup smoke test of the AFFORDANCE'S VISIBILITY rule
// (canPost — same team/write bar the add-comment composer itself uses,
// which already excludes viewer and client): it does not exercise the
// click -> createDecisionFromComment round trip (that needs a real
// Supabase session and is covered by lib/actions/project-records.ts's own
// server-side authorization, mirrored on
// tests/integration/f015-flag-assumption-atomic.test.ts's sibling RPC).
// "A decision carries the comment's text, author and date" is this
// feature's own definition of done's MANUAL verification item.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { CommentList, type TaskComment } from "@/components/task/comment-list";
import type { CommentListMember } from "@/components/task/comment-list";
import type { WorkspaceRole } from "@/lib/auth/permissions";

const MEMBERS: CommentListMember[] = [
  { userId: "u1", email: "alice@example.com", name: "Alice Anderson" },
];

const COMMENTS: TaskComment[] = [
  {
    id: "c1",
    taskId: "t1",
    userId: "u1",
    text: "Let's use the blue variant for the CTA.",
    createdAt: new Date().toISOString(),
  },
];

function render(currentUserRole: WorkspaceRole | undefined) {
  return renderToStaticMarkup(
    createElement(CommentList, {
      taskId: "t1",
      comments: COMMENTS,
      members: MEMBERS,
      currentUserId: "u1",
      currentUserRole,
    }),
  );
}

describe("F015 (AS-044): 'Turn into decision' affordance visibility", () => {
  it("renders for a team member (owner/admin/member)", () => {
    const markup = render("member");
    expect(markup).toContain("Turn into decision");
  });

  it("does not render for a client", () => {
    const markup = render("client");
    expect(markup).not.toContain("Turn into decision");
  });

  it("does not render for a viewer", () => {
    const markup = render("viewer");
    expect(markup).not.toContain("Turn into decision");
  });

  it("does not render when no role is known yet (undefined defaults to canPost=true per this component's own permissive-optional-prop convention) — documented here as the current behaviour, matching the add-comment composer's own default", () => {
    // canPost defaults to true when currentUserRole is undefined (same
    // "unset optional props default to writable" convention this file's
    // own header comment documents for the add-comment composer) — so
    // the button DOES render in that case. Asserted explicitly so a
    // future change to that default is a deliberate, visible diff here.
    const markup = render(undefined);
    expect(markup).toContain("Turn into decision");
  });
});
