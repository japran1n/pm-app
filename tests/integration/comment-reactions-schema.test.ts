// Integration tests for F199's comment_reactions table + RLS
// (AS-365, AS-368, AS-370) — run against the real linked Supabase
// project, same loadDotEnv/skipIf/admin+session-client pattern
// tests/integration/task-activity-feed.test.ts (F196) and
// tests/integration/task-activity-writer.test.ts (F195) already
// established. F199 is a DB-schema-only feature (no Server Action layer
// yet — that lands in later F200/F201/F202), so these tests exercise the
// table directly through real signed-in sessions to prove the
// constraints and RLS policies actually hold at the database level, not
// just "the app wouldn't normally do this".

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F199: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "comment_reactions table + RLS (F199: AS-365, AS-368, AS-370)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let commentId: string;
    let memberUserId: string;
    let memberSessionClient: SupabaseClient;
    let outsiderUserId: string;
    let outsiderSessionClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F199 workspace", slug: `f199-reactions-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const memberEmail = `f199-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "member",
          status: "active",
        });
      if (memberInsertErr) {
        throw new Error(`Failed to seed membership: ${memberInsertErr.message}`);
      }

      // AS-370/negative-RLS fixture: a real signed-in user with NO
      // membership in this workspace at all.
      const outsiderEmail = `f199-outsider-${uniqueSuffix}@example.com`;
      const outsiderPassword = "Test-password-1!";
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: outsiderPassword,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      }
      outsiderUserId = outsiderAuth.user.id;

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F199 project" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to create project: ${projectErr?.message}`);
      projectId = project.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F199 reactions task",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`Failed to create task: ${taskErr?.message}`);
      taskId = task.id;

      const { data: comment, error: commentErr } = await adminClient
        .from("comments")
        .insert({ task_id: taskId, user_id: memberUserId, text: "F199 comment to react to" })
        .select("id")
        .single();
      if (commentErr || !comment) throw new Error(`Failed to create comment: ${commentErr?.message}`);
      commentId = comment.id;

      memberSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberSignInErr } =
        await memberSessionClient.auth.signInWithPassword({
          email: memberEmail,
          password: memberPassword,
        });
      if (memberSignInErr) {
        throw new Error(`Failed to sign in member: ${memberSignInErr.message}`);
      }

      outsiderSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: outsiderSignInErr } =
        await outsiderSessionClient.auth.signInWithPassword({
          email: outsiderEmail,
          password: outsiderPassword,
        });
      if (outsiderSignInErr) {
        throw new Error(`Failed to sign in outsider: ${outsiderSignInErr.message}`);
      }
    });

    afterAll(async () => {
      if (commentId) {
        await adminClient.from("comment_reactions").delete().eq("comment_id", commentId);
        await adminClient.from("comments").delete().eq("id", commentId);
      }
      if (taskId) await adminClient.from("tasks").delete().eq("id", taskId);
      if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
    });

    it("test_AS_365_a_member_can_add_an_emoji_reaction_to_a_comment_on_a_task_they_can_see", async () => {
      const { data, error } = await memberSessionClient
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: memberUserId, emoji: "👍" })
        .select("comment_id, user_id, emoji")
        .single();

      expect(error).toBeNull();
      expect(data).toEqual({ comment_id: commentId, user_id: memberUserId, emoji: "👍" });

      const { data: rows, error: readErr } = await memberSessionClient
        .from("comment_reactions")
        .select("emoji")
        .eq("comment_id", commentId);
      expect(readErr).toBeNull();
      expect(rows?.map((r) => r.emoji)).toEqual(["👍"]);
    });

    it("test_AS_368_a_duplicate_reaction_same_emoji_same_comment_same_user_is_rejected_by_the_primary_key", async () => {
      // First insert should succeed (or already exist from a prior test
      // in this file — use a distinct emoji to isolate this test).
      const first = await memberSessionClient
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: memberUserId, emoji: "🎉" });
      expect(first.error).toBeNull();

      // Second insert of the SAME (comment_id, user_id, emoji) tuple must
      // be rejected — this is the primary key doing real work, not an
      // app-layer convention.
      const second = await memberSessionClient
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: memberUserId, emoji: "🎉" });
      expect(second.error).not.toBeNull();
      expect(second.error?.code).toBe("23505"); // unique_violation (PK)

      const { data: rows } = await memberSessionClient
        .from("comment_reactions")
        .select("emoji")
        .eq("comment_id", commentId)
        .eq("emoji", "🎉");
      expect(rows?.length).toBe(1);
    });

    it("test_AS_368_negative_a_different_emoji_from_the_same_user_on_the_same_comment_is_allowed", async () => {
      const { error } = await memberSessionClient
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: memberUserId, emoji: "❤️" });
      expect(error).toBeNull();
    });

    it("test_AS_365_negative_emoji_outside_the_allow_list_is_rejected_by_the_CHECK_constraint", async () => {
      const { error } = await memberSessionClient
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: memberUserId, emoji: "🍕" });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23514"); // check_violation
    });

    it("test_AS_365_negative_a_user_cannot_insert_a_reaction_row_claiming_another_users_id", async () => {
      const { error } = await memberSessionClient
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: outsiderUserId, emoji: "👀" });
      // Blocked by RLS with-check (user_id = auth.uid()).
      expect(error).not.toBeNull();
    });

    it("test_AS_365_negative_an_outsider_who_cannot_see_the_task_cannot_react_to_its_comment", async () => {
      const { error } = await outsiderSessionClient
        .from("comment_reactions")
        .insert({ comment_id: commentId, user_id: outsiderUserId, emoji: "🚀" });
      expect(error).not.toBeNull();

      // Nor can they read the (invisible) reactions on it.
      const { data: rows } = await outsiderSessionClient
        .from("comment_reactions")
        .select("emoji")
        .eq("comment_id", commentId);
      expect(rows).toEqual([]);
    });

    it("test_AS_370_hard_deleting_a_comment_cascades_to_remove_its_reactions", async () => {
      const { data: tempComment, error: tempCommentErr } = await adminClient
        .from("comments")
        .insert({ task_id: taskId, user_id: memberUserId, text: "F199 comment to be hard-deleted" })
        .select("id")
        .single();
      expect(tempCommentErr).toBeNull();
      const tempCommentId = tempComment!.id;

      const { error: reactErr } = await adminClient
        .from("comment_reactions")
        .insert({ comment_id: tempCommentId, user_id: memberUserId, emoji: "👍" });
      expect(reactErr).toBeNull();

      const before = await adminClient
        .from("comment_reactions")
        .select("comment_id")
        .eq("comment_id", tempCommentId);
      expect(before.data?.length).toBe(1);

      const { error: deleteErr } = await adminClient
        .from("comments")
        .delete()
        .eq("id", tempCommentId);
      expect(deleteErr).toBeNull();

      const after = await adminClient
        .from("comment_reactions")
        .select("comment_id")
        .eq("comment_id", tempCommentId);
      expect(after.data).toEqual([]);
    });
  },
);
