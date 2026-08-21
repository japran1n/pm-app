// Integration test for F164 (AS-295, AS-296), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/add-comment.test.ts and tests/integration/rls-task-watchers.test.ts.
//
// Unlike add-comment.test.ts's mock (which only stubs auth.getUser()),
// watchTask/unwatchTask perform their actual row write through the
// caller's own session (per the clarified "state location" answer), so
// `@/lib/supabase/server`'s createClient() is mocked to return a REAL,
// signed-in Supabase client (publishable key) for the current test user —
// this exercises the real RLS policies from
// supabase/migrations/20260822040000_task_watchers.sql and
// 20260822053000_task_watchers_durable_unwatch.sql, not a stub.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F164: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Swapped per test via beforeEach/individual assignment — the currently
// "signed in" per-user client that the mocked createClient() returns.
let currentSessionClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSessionClient,
}));

describe.skipIf(!haveAdminCreds)("watchTask / unwatchTask (F164: AS-295, AS-296)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;
  let projectId: string;
  let taskId: string;
  let memberEmail: string;
  let memberPassword: string;
  let memberUserId: string;
  let memberClient: SupabaseClient;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "F164 Test Workspace",
        slug: `f164-watchers-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `f164-member-${uniqueSuffix}@example.com`;
    memberPassword = "Test-password-1!";
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
    createdUserIds.push(memberUserId);

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      role: "member",
      status: "active",
    });
    if (memberInsertErr) {
      throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
    }

    const { data: proj, error: projErr } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `F164 Project ${uniqueSuffix}`,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    if (projErr || !proj) {
      throw new Error(`Failed to create test project: ${projErr?.message}`);
    }
    projectId = proj.id;

    const { data: task, error: taskErr } = await adminClient
      .from("tasks")
      .insert({
        project_id: projectId,
        title: `F164 Task ${uniqueSuffix}`,
        author_id: memberUserId,
      })
      .select("id")
      .single();
    if (taskErr || !task) {
      throw new Error(`Failed to create test task: ${taskErr?.message}`);
    }
    taskId = task.id;

    memberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInErr } = await memberClient.auth.signInWithPassword({
      email: memberEmail,
      password: memberPassword,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in member test user: ${signInErr.message}`);
    }
  });

  beforeEach(() => {
    currentSessionClient = memberClient;
  });

  afterAll(async () => {
    await adminClient.from("task_watchers").delete().eq("task_id", taskId);
    await adminClient.from("tasks").delete().eq("id", taskId);
    await adminClient.from("projects").delete().eq("id", projectId);
    for (const wsId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
      await adminClient.from("workspaces").delete().eq("id", wsId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  it("AS-295: watchTask adds a watcher row for the calling member", async () => {
    const { watchTask } = await import("@/lib/actions/watchers");

    const result = await watchTask(taskId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isWatching).toBe(true);

    const { data: row, error } = await adminClient
      .from("task_watchers")
      .select("task_id, user_id, is_watching")
      .eq("task_id", taskId)
      .eq("user_id", memberUserId)
      .single();
    expect(error).toBeNull();
    expect(row?.is_watching).toBe(true);
  });

  it("watchTask is idempotent — calling it twice does not error", async () => {
    const { watchTask } = await import("@/lib/actions/watchers");

    const first = await watchTask(taskId);
    const second = await watchTask(taskId);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const { data: rows, error } = await adminClient
      .from("task_watchers")
      .select("task_id, user_id")
      .eq("task_id", taskId)
      .eq("user_id", memberUserId);
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
  });

  it("AS-296: unwatchTask marks the caller's watcher row not-watching", async () => {
    const { watchTask, unwatchTask } = await import("@/lib/actions/watchers");

    await watchTask(taskId);
    const result = await unwatchTask(taskId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.isWatching).toBe(false);

    const { data: row, error } = await adminClient
      .from("task_watchers")
      .select("is_watching")
      .eq("task_id", taskId)
      .eq("user_id", memberUserId)
      .single();
    expect(error).toBeNull();
    expect(row?.is_watching).toBe(false);
  });

  it("AS-296: an unauthenticated caller cannot watch or unwatch a task", async () => {
    const { watchTask, unwatchTask } = await import("@/lib/actions/watchers");

    currentSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!); // no session

    const watchResult = await watchTask(taskId);
    expect(watchResult.ok).toBe(false);

    const unwatchResult = await unwatchTask(taskId);
    expect(unwatchResult.ok).toBe(false);
  });

  it("a user who is not a member of the task's workspace cannot watch the task", async () => {
    const { watchTask } = await import("@/lib/actions/watchers");

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nonMemberEmail = `f164-nonmember-${uniqueSuffix}@example.com`;
    const nonMemberPassword = "Test-password-1!";
    const { data: nonMemberAuth, error: nonMemberAuthErr } =
      await adminClient.auth.admin.createUser({
        email: nonMemberEmail,
        password: nonMemberPassword,
        email_confirm: true,
      });
    if (nonMemberAuthErr || !nonMemberAuth.user) {
      throw new Error(`Failed to create non-member user: ${nonMemberAuthErr?.message}`);
    }
    createdUserIds.push(nonMemberAuth.user.id);

    const nonMemberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInErr } = await nonMemberClient.auth.signInWithPassword({
      email: nonMemberEmail,
      password: nonMemberPassword,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in non-member test user: ${signInErr.message}`);
    }

    currentSessionClient = nonMemberClient;

    const result = await watchTask(taskId);
    expect(result.ok).toBe(false);

    const { data: rows } = await adminClient
      .from("task_watchers")
      .select("task_id")
      .eq("task_id", taskId)
      .eq("user_id", nonMemberAuth.user.id);
    expect(rows ?? []).toHaveLength(0);
  });

  describe("durability rule: explicit unwatch survives a later comment", () => {
    beforeEach(() => {
      currentSessionClient = memberClient;
    });

    it("AS-295 + AS-296: commenting adds a first-time watcher, but a comment AFTER an explicit unwatch does NOT re-add them", async () => {
      const { addComment } = await import("@/lib/actions/comments");
      const { unwatchTask } = await import("@/lib/actions/watchers");

      // Fresh commenter with no prior task_watchers row at all.
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const commenterEmail = `f164-commenter-${uniqueSuffix}@example.com`;
      const commenterPassword = "Test-password-1!";
      const { data: commenterAuth, error: commenterAuthErr } =
        await adminClient.auth.admin.createUser({
          email: commenterEmail,
          password: commenterPassword,
          email_confirm: true,
        });
      if (commenterAuthErr || !commenterAuth.user) {
        throw new Error(`Failed to create commenter user: ${commenterAuthErr?.message}`);
      }
      createdUserIds.push(commenterAuth.user.id);
      const commenterUserId = commenterAuth.user.id;

      const { error: commenterMemberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: commenterUserId,
        role: "member",
        status: "active",
      });
      if (commenterMemberErr) {
        throw new Error(`Failed to seed commenter membership: ${commenterMemberErr.message}`);
      }

      const commenterClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: commenterSignInErr } = await commenterClient.auth.signInWithPassword({
        email: commenterEmail,
        password: commenterPassword,
      });
      if (commenterSignInErr) {
        throw new Error(`Failed to sign in commenter: ${commenterSignInErr.message}`);
      }

      // AS-295: first comment on this task by this user, who has never had
      // a task_watchers row — should auto-add them as watching: true.
      currentSessionClient = commenterClient;
      const firstComment = await addComment(taskId, `F164 first comment ${uniqueSuffix}`);
      expect(firstComment.ok).toBe(true);

      const { data: afterFirstComment } = await adminClient
        .from("task_watchers")
        .select("is_watching")
        .eq("task_id", taskId)
        .eq("user_id", commenterUserId)
        .single();
      expect(afterFirstComment?.is_watching).toBe(true);

      // Explicit unwatch.
      currentSessionClient = commenterClient;
      const unwatchResult = await unwatchTask(taskId);
      expect(unwatchResult.ok).toBe(true);

      const { data: afterUnwatch } = await adminClient
        .from("task_watchers")
        .select("is_watching")
        .eq("task_id", taskId)
        .eq("user_id", commenterUserId)
        .single();
      expect(afterUnwatch?.is_watching).toBe(false);

      // AS-296's teeth: a later comment by the same user must NOT
      // silently flip is_watching back to true.
      currentSessionClient = commenterClient;
      const secondComment = await addComment(taskId, `F164 second comment ${uniqueSuffix}`);
      expect(secondComment.ok).toBe(true);

      const { data: afterSecondComment, error: afterSecondCommentErr } = await adminClient
        .from("task_watchers")
        .select("is_watching")
        .eq("task_id", taskId)
        .eq("user_id", commenterUserId)
        .single();
      expect(afterSecondCommentErr).toBeNull();
      expect(afterSecondComment?.is_watching).toBe(false);
    });
  });
});
