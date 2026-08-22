// F204 (AS-376): unit coverage for lib/comments/mentions.ts's pure
// document-walking logic, with a minimal mocked admin client standing in
// for the two batched Supabase queries — complements
// tests/integration/mention-visibility.test.ts's real-database proof.

import { describe, expect, it } from "vitest";

import { sanitiseMentionsForVisibility } from "@/lib/comments/mentions";

type Row = Record<string, unknown>;

function fakeAdmin({
  workspaceMembers,
  projectMembers,
}: {
  workspaceMembers: Row[];
  projectMembers: Row[];
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
        then: (resolve: (result: { data: Row[] }) => void) =>
          resolve({ data: rows.filter((row) => filters.every((f) => f(row))) }),
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
