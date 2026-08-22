// Integration test for F197 (AS-362, AS-364), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf/makeUser/afterAll
// pattern established by tests/integration/delete-comment.test.ts, plus
// restore-comment.test.ts's realtimeClientForServerAction wiring (editComment
// also broadcasts).
//
// AS-364 ("cannot edit someone else's comment, including via direct API")
// is verified two ways:
//  - via the Server Action (editComment) called as a different member and
//    as a workspace admin — deliberately author-only, unlike
//    delete/restore's author-or-admin rule (see lib/actions/comments.ts's
//    editComment doc comment for the confirmed reading).
//  - via a direct API call: a real signed-in non-author session, using the
//    publishable key (not the admin client), issuing the UPDATE straight
//    against PostgREST — rejected by the BEFORE UPDATE trigger added in
//    supabase/migrations/20260823000000_comment_edit.sql, which is
//    additive defense-in-depth on top of the pre-existing
//    comments_update_author_or_admin RLS policy (that policy alone would
//    still let an admin's UPDATE through; the trigger is what actually
//    blocks a content edit for anyone but the author — see the migration's
//    doc comment for the full column-comparison rationale).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

import { vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
    channel: (name: string) => realtimeClientForServerAction!.channel(name),
    removeChannel: (ch: unknown) =>
      realtimeClientForServerAction!.removeChannel(ch as never),
  }),
}));

let realtimeClientForServerAction: SupabaseClient | null = null;

describe.skipIf(!haveAdminCreds)("editComment (F197: AS-362, AS-364)", () => {
  let adminClient: SupabaseClient;
  const createdCommentIds: string[] = [];
  const createdTaskIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  let authorUserId: string;
  let otherMemberUserId: string;
  let adminUserId: string;

  let authorEmail: string;
  let otherMemberEmail: string;
  let adminEmail: string;
  const password = "Test-password-1!";

  const ANON_KEY = PUBLISHABLE_KEY ?? SECRET_KEY!;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    realtimeClientForServerAction = createClient(SUPABASE_URL!, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "F197 Test Workspace",
        slug: `f197-comments-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    async function makeUser(label: string) {
      const email = `f197-${label}-${uniqueSuffix}@example.com`;
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Failed to create ${label} user: ${error?.message}`);
      }
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email };
    }

    const author = await makeUser("author");
    authorUserId = author.id;
    authorEmail = author.email;

    const otherMember = await makeUser("other-member");
    otherMemberUserId = otherMember.id;
    otherMemberEmail = otherMember.email;

    const admin = await makeUser("admin");
    adminUserId = admin.id;
    adminEmail = admin.email;

    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert([
        {
          workspace_id: workspaceId,
          user_id: authorUserId,
          role: "member",
          status: "active",
        },
        {
          workspace_id: workspaceId,
          user_id: otherMemberUserId,
          role: "member",
          status: "active",
        },
        {
          workspace_id: workspaceId,
          user_id: adminUserId,
          role: "admin",
          status: "active",
        },
      ]);
    if (memberInsertErr) {
      throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F197 Project ${uniqueSuffix}`,
        created_by: authorUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;
    createdProjectIds.push(projectId);

    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: `F197 Task ${uniqueSuffix}`,
        author_id: authorUserId,
      })
      .select("id")
      .single();
    if (taskErr || !task) {
      throw new Error(`Failed to create test task: ${taskErr?.message}`);
    }
    taskId = task.id;
    createdTaskIds.push(taskId);
  });

  beforeEach(() => {
    currentTestUserId = null;
  });

  afterAll(async () => {
    for (const commentId of createdCommentIds) {
      await adminClient.from("comments").delete().eq("id", commentId);
    }
    for (const tId of createdTaskIds) {
      await adminClient.from("tasks").delete().eq("id", tId);
    }
    for (const pId of createdProjectIds) {
      await adminClient.from("projects").delete().eq("id", pId);
    }
    for (const wsId of createdWorkspaceIds) {
      await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  async function makeComment(text: string): Promise<string> {
    const { data, error } = await adminClient
      .from("comments")
      .insert({
        task_id: taskId,
        user_id: authorUserId,
        text,
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Failed to seed comment: ${error?.message}`);
    }
    createdCommentIds.push(data.id);
    return data.id;
  }

  it("AS-362: the comment's own author can edit their own comment", async () => {
    const { editComment } = await import("@/lib/actions/comments");
    const commentId = await makeComment("original text");

    currentTestUserId = authorUserId;
    const result = await editComment(commentId, "edited text");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.text).toBe("edited text");
    expect(result.data.editedAt).toBeTruthy();

    const { data: row, error: rowError } = await adminClient
      .from("comments")
      .select("id, text, edited_at")
      .eq("id", commentId)
      .single();
    expect(rowError).toBeNull();
    expect(row?.text).toBe("edited text");
    expect(row?.edited_at).not.toBeNull();
  });

  it("AS-362 side effect: editing one comment does not affect another comment on the same task", async () => {
    const { editComment } = await import("@/lib/actions/comments");
    const commentId = await makeComment("comment A");
    const untouchedCommentId = await makeComment("comment B");

    currentTestUserId = authorUserId;
    const result = await editComment(commentId, "comment A edited");
    expect(result.ok).toBe(true);

    const { data: untouchedRow } = await adminClient
      .from("comments")
      .select("text, edited_at")
      .eq("id", untouchedCommentId)
      .single();
    expect(untouchedRow?.text).toBe("comment B");
    expect(untouchedRow?.edited_at).toBeNull();
  });

  it("AS-364: a different regular member (not the author) cannot edit someone else's comment via the Server Action", async () => {
    const { editComment } = await import("@/lib/actions/comments");
    const commentId = await makeComment("author's original text");

    currentTestUserId = otherMemberUserId;
    const result = await editComment(commentId, "hijacked text");

    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("comments")
      .select("text, edited_at")
      .eq("id", commentId)
      .single();
    expect(row?.text).toBe("author's original text");
    expect(row?.edited_at).toBeNull();
  });

  it("AS-364: a workspace admin cannot edit another member's comment via the Server Action (author-only, unlike delete)", async () => {
    const { editComment } = await import("@/lib/actions/comments");
    const commentId = await makeComment("author's original text");

    currentTestUserId = adminUserId;
    const result = await editComment(commentId, "admin-edited text");

    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("comments")
      .select("text, edited_at")
      .eq("id", commentId)
      .single();
    expect(row?.text).toBe("author's original text");
    expect(row?.edited_at).toBeNull();
  });

  it("AS-364: a different regular member cannot edit a comment via a direct API call bypassing the Server Action (real session, publishable key) — blocked by the existing author-or-admin RLS policy", async () => {
    const commentId = await makeComment("direct-api original text");

    const otherMemberClient = createClient(SUPABASE_URL!, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await otherMemberClient.auth.signInWithPassword({
      email: otherMemberEmail,
      password,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in other-member test user: ${signInErr.message}`);
    }

    // A plain, non-author, non-admin member is already blocked by the
    // pre-existing comments_update_author_or_admin RLS policy's `using`
    // clause (0 rows match, per PostgREST's usual "RLS filtered every
    // candidate row" behaviour: no error, but nothing changes) — this is
    // the row unaffected by the update either way.
    await otherMemberClient
      .from("comments")
      .update({ text: "direct-api hijacked text", body_text: "direct-api hijacked text" })
      .eq("id", commentId);

    const { data: row } = await adminClient
      .from("comments")
      .select("text, edited_at")
      .eq("id", commentId)
      .single();
    expect(row?.text).toBe("direct-api original text");
    expect(row?.edited_at).toBeNull();
  });

  it("AS-364: a workspace admin cannot edit another member's comment via a direct API call bypassing the Server Action — blocked by the BEFORE UPDATE trigger, not just RLS", async () => {
    const commentId = await makeComment("admin direct-api original text");

    // Unlike the plain-member case above, the pre-existing
    // comments_update_author_or_admin RLS policy WOULD let an admin's
    // UPDATE through (admin/owner is explicitly allowed by that policy's
    // predicate, since it also backs delete/restore). This is exactly the
    // gap supabase/migrations/20260823000000_comment_edit.sql's BEFORE
    // UPDATE trigger closes: it inspects OLD vs NEW body_text/body_json/
    // text and rejects the change outright when the caller isn't the
    // comment's own author, regardless of their role.
    const adminApiClient = createClient(SUPABASE_URL!, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await adminApiClient.auth.signInWithPassword({
      email: adminEmail,
      password,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in admin test user: ${signInErr.message}`);
    }

    const { error: updateErr } = await adminApiClient
      .from("comments")
      .update({
        text: "admin direct-api hijacked text",
        body_text: "admin direct-api hijacked text",
      })
      .eq("id", commentId);

    expect(updateErr).not.toBeNull();

    const { data: row } = await adminClient
      .from("comments")
      .select("text, edited_at")
      .eq("id", commentId)
      .single();
    expect(row?.text).toBe("admin direct-api original text");
    expect(row?.edited_at).toBeNull();
  });

  it("AS-362: the author CAN edit their own comment via a direct API call using their own real session", async () => {
    const commentId = await makeComment("author direct-api original");

    const authorClient = createClient(SUPABASE_URL!, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await authorClient.auth.signInWithPassword({
      email: authorEmail,
      password,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in author test user: ${signInErr.message}`);
    }

    const { error: updateErr } = await authorClient
      .from("comments")
      .update({
        text: "author direct-api edited",
        body_text: "author direct-api edited",
      })
      .eq("id", commentId);

    expect(updateErr).toBeNull();

    const { data: row } = await adminClient
      .from("comments")
      .select("text")
      .eq("id", commentId)
      .single();
    expect(row?.text).toBe("author direct-api edited");
  });

  it("an empty/whitespace-only edit is rejected before ever reaching the database", async () => {
    const { editComment } = await import("@/lib/actions/comments");
    const commentId = await makeComment("keep me");

    currentTestUserId = authorUserId;
    const result = await editComment(commentId, "   ");

    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("comments")
      .select("text, edited_at")
      .eq("id", commentId)
      .single();
    expect(row?.text).toBe("keep me");
    expect(row?.edited_at).toBeNull();
  });

  it("an already soft-deleted comment is treated as not found by editComment", async () => {
    const { editComment } = await import("@/lib/actions/comments");
    const commentId = await makeComment("about to be deleted");
    await adminClient
      .from("comments")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", commentId);

    currentTestUserId = authorUserId;
    const result = await editComment(commentId, "should not apply");

    expect(result.ok).toBe(false);
  });
});
