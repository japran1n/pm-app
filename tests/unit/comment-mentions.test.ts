// F204 (AS-376): unit coverage for lib/comments/mentions.ts's pure
// document-walking logic, with a minimal mocked admin client standing in
// for the two batched Supabase queries — complements
// tests/integration/mention-visibility.test.ts's real-database proof.

import { describe, expect, it } from "vitest";

import {
  MentionVisibilityCheckError,
  resolveVisibleMentionIds,
  sanitiseMentionsForVisibility,
} from "@/lib/comments/mentions";

type Row = Record<string, unknown>;

function fakeAdmin({
  workspaceMembers,
  projectMembers,
  // F301: when set, the query against this table resolves with
  // `{ data: null, error: erroringTable's error }` instead of rows, so
  // tests can prove a transient DB failure is surfaced rather than
  // silently treated as "no rows" (scrutiny finding D5).
  erroringTable,
}: {
  workspaceMembers: Row[];
  projectMembers: Row[];
  erroringTable?: "workspace_members" | "project_members";
}) {
  return {
    from(table: string) {
      const rows = table === "workspace_members" ? workspaceMembers : projectMembers;
      const filters: Array<(row: Row) => boolean> = [];
      const builder = {
        select: () => builder,
        eq: (col: string, value: unknown) => {
          filters.push((row) => row[col] === value);
          return builder;
        },
        in: (col: string, values: unknown[]) => {
          filters.push((row) => values.includes(row[col]));
          return builder;
        },
        then: (resolve: (result: { data: Row[] | null; error: unknown }) => void) => {
          if (table === erroringTable) {
            resolve({
              data: null,
              error: { message: `simulated ${table} read failure` },
            });
            return;
          }
          resolve({
            data: rows.filter((row) => filters.every((f) => f(row))),
            error: null,
          });
        },
      };
      return builder;
    },
  } as unknown as Parameters<typeof sanitiseMentionsForVisibility>[0];
}

describe("AS-376: sanitiseMentionsForVisibility strips mentions of users invisible to the commenter", () => {
  it("test_AS_376_strips_a_mention_referencing_a_user_with_no_workspace_membership_at_all", async () => {
    const admin = fakeAdmin({ workspaceMembers: [], projectMembers: [] });
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "ghost-user" } }],
        },
      ],
    };

    const result = await sanitiseMentionsForVisibility(admin, doc as never, {
      projectId: "p-1",
      workspaceId: "w-1",
      projectVisibility: "workspace",
    });

    expect(JSON.stringify(result)).not.toContain("ghost-user");
    expect(JSON.stringify(result)).not.toContain('"mention"');
    expect(JSON.stringify(result)).toContain("Former member");
  });

  it("test_AS_376_strips_a_mention_referencing_an_active_workspace_member_with_no_access_to_a_private_project", async () => {
    const admin = fakeAdmin({
      workspaceMembers: [
        { user_id: "outsider", role: "member", status: "active", workspace_id: "w-1" },
      ],
      projectMembers: [],
    });
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "outsider" } }],
        },
      ],
    };

    const result = await sanitiseMentionsForVisibility(admin, doc as never, {
      projectId: "private-project",
      workspaceId: "w-1",
      projectVisibility: "private",
    });

    expect(JSON.stringify(result)).not.toContain('"mention"');
  });

  it("test_AS_376_keeps_a_mention_referencing_a_user_with_an_explicit_project_members_row", async () => {
    const admin = fakeAdmin({
      workspaceMembers: [
        { user_id: "insider", role: "member", status: "active", workspace_id: "w-1" },
      ],
      projectMembers: [{ user_id: "insider", project_id: "private-project" }],
    });
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "insider" } }],
        },
      ],
    };

    const result = await sanitiseMentionsForVisibility(admin, doc as never, {
      projectId: "private-project",
      workspaceId: "w-1",
      projectVisibility: "private",
    });

    expect(JSON.stringify(result)).toContain('"mention"');
    expect(JSON.stringify(result)).toContain("insider");
  });

  it("test_AS_376_keeps_a_mention_referencing_a_workspace_owner_even_without_an_explicit_project_members_row", async () => {
    const admin = fakeAdmin({
      workspaceMembers: [{ user_id: "owner-1", role: "owner", status: "active", workspace_id: "w-1" }],
      projectMembers: [],
    });
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "owner-1" } }],
        },
      ],
    };

    const result = await sanitiseMentionsForVisibility(admin, doc as never, {
      projectId: "private-project",
      workspaceId: "w-1",
      projectVisibility: "private",
    });

    expect(JSON.stringify(result)).toContain('"mention"');
  });

  it("test_AS_376_keeps_a_mention_on_a_workspace_visible_project_for_any_active_member", async () => {
    const admin = fakeAdmin({
      workspaceMembers: [{ user_id: "member-1", role: "member", status: "active", workspace_id: "w-1" }],
      projectMembers: [],
    });
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "member-1" } }],
        },
      ],
    };

    const result = await sanitiseMentionsForVisibility(admin, doc as never, {
      projectId: "public-project",
      workspaceId: "w-1",
      projectVisibility: "workspace",
    });

    expect(JSON.stringify(result)).toContain('"mention"');
  });

  it("test_AS_376_a_document_with_no_mention_nodes_is_returned_unchanged", async () => {
    const admin = fakeAdmin({ workspaceMembers: [], projectMembers: [] });
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }],
    };

    const result = await sanitiseMentionsForVisibility(admin, doc as never, {
      projectId: "p-1",
      workspaceId: "w-1",
      projectVisibility: "workspace",
    });

    expect(result).toEqual(doc);
  });
});

// F301 (scrutiny finding D5): a forced query error must never be treated
// as "no rows returned" — that previously made every mentioned id look
// invisible and permanently corrupted the stored document by rewriting
// every mention to "@Former member" on a transient DB error. The fix:
// `resolveVisibleMentionIds` now throws `MentionVisibilityCheckError`
// instead, and `sanitiseMentionsForVisibility` propagates it unchanged so
// its callers (addComment/editComment/editTask) fail the whole write
// rather than persisting a corrupted document.
describe("F301: a transient DB error resolving mention visibility never silently strips mentions", () => {
  it("test_F301_resolveVisibleMentionIds_throws_on_a_workspace_members_query_error_instead_of_treating_it_as_zero_visible_ids", async () => {
    const admin = fakeAdmin({
      workspaceMembers: [],
      projectMembers: [],
      erroringTable: "workspace_members",
    });

    await expect(
      resolveVisibleMentionIds(admin, ["alice"], {
        projectId: "p-1",
        workspaceId: "w-1",
        projectVisibility: "workspace",
      }),
    ).rejects.toBeInstanceOf(MentionVisibilityCheckError);
  });

  it("test_F301_resolveVisibleMentionIds_throws_on_a_project_members_query_error_instead_of_treating_it_as_zero_visible_ids", async () => {
    const admin = fakeAdmin({
      workspaceMembers: [
        { user_id: "alice", role: "member", status: "active", workspace_id: "w-1" },
      ],
      projectMembers: [],
      erroringTable: "project_members",
    });

    await expect(
      resolveVisibleMentionIds(admin, ["alice"], {
        projectId: "private-project",
        workspaceId: "w-1",
        projectVisibility: "private",
      }),
    ).rejects.toBeInstanceOf(MentionVisibilityCheckError);
  });

  it("test_F301_sanitiseMentionsForVisibility_propagates_the_error_instead_of_returning_a_document_with_mentions_stripped_to_Former_member", async () => {
    const admin = fakeAdmin({
      workspaceMembers: [],
      projectMembers: [],
      erroringTable: "workspace_members",
    });
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "mention", attrs: { id: "alice" } }],
        },
      ],
    };

    await expect(
      sanitiseMentionsForVisibility(admin, doc as never, {
        projectId: "p-1",
        workspaceId: "w-1",
        projectVisibility: "workspace",
      }),
    ).rejects.toBeInstanceOf(MentionVisibilityCheckError);

    // The document itself (the caller's in-memory copy) is never mutated
    // or rewritten as a side effect of the failed check — only the
    // rejection is observable.
    expect(JSON.stringify(doc)).toContain('"mention"');
    expect(JSON.stringify(doc)).not.toContain("Former member");
  });
});
