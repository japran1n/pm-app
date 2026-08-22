// Integration test for F192 (AS-348, AS-349), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/delete-attachment.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a
// real throwaway Supabase Auth user for the current test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const BUCKET = "task-attachments";

let currentTestUserId: string | null = null;

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
    rpc: async () => ({ error: null }), // writeAudit's call site (unused when session-less)
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "purgeTrashItem (F192: AS-348, AS-349)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdCommentIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdObjectPaths: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let ownerUserId: string;
    let adminUserId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F192 Test Workspace",
          slug: `f192-purge-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function makeUser(label: string) {
        const email = `f192-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        createdUserIds.push(data.user.id);
        return data.user.id;
      }

      ownerUserId = await makeUser("owner");
      adminUserId = await makeUser("admin");
      memberUserId = await makeUser("member");

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: ownerUserId,
            role: "owner",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: adminUserId,
            role: "admin",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: memberUserId,
            role: "member",
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
          name: `F192 Project ${uniqueSuffix}`,
          created_by: ownerUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      if (createdObjectPaths.length) {
        await adminClient.storage.from(BUCKET).remove(createdObjectPaths);
      }
      for (const commentId of createdCommentIds) {
        await adminClient.from("comments").delete().eq("id", commentId);
      }
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
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

    async function makeDeletedTask(withAttachment: boolean) {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F192 Task ${uniqueSuffix}`,
          author_id: ownerUserId,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      createdTaskIds.push(task.id);

      let objectPath: string | null = null;
      if (withAttachment) {
        objectPath = `${task.id}/${uniqueSuffix}-notes.txt`;
        const { error: uploadError } = await adminClient.storage
          .from(BUCKET)
          .upload(objectPath, new Blob(["hello"]), {
            contentType: "text/plain",
            upsert: false,
          });
        if (uploadError) {
          throw new Error(
            `Failed to seed storage object: ${uploadError.message}`,
          );
        }
        createdObjectPaths.push(objectPath);

        const { error: attachmentErr } = await adminClient
          .from("attachments")
          .insert({
            task_id: task.id,
            file_url: objectPath,
            file_name: "notes.txt",
            uploaded_by: ownerUserId,
          });
        if (attachmentErr) {
          throw new Error(
            `Failed to seed attachment row: ${attachmentErr.message}`,
          );
        }

        const { error: checklistErr } = await adminClient
          .from("checklist_items")
          .insert({ task_id: task.id, content: "a checklist item" });
        if (checklistErr) {
          throw new Error(
            `Failed to seed checklist item: ${checklistErr.message}`,
          );
        }

        const { error: assigneeErr } = await adminClient
          .from("task_assignees")
          .insert({ task_id: task.id, user_id: memberUserId });
        if (assigneeErr) {
          throw new Error(
            `Failed to seed task assignee: ${assigneeErr.message}`,
          );
        }
      }

      return { taskId: task.id as string, objectPath };
    }

    async function makeLiveTask() {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F192 Live Task ${uniqueSuffix}`,
          author_id: ownerUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create live task: ${taskErr?.message}`);
      }
      createdTaskIds.push(task.id);
      return task.id as string;
    }

    async function makeDeletedComment() {
      const liveTaskId = await makeLiveTask();
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: comment, error: commentErr } = await adminClient
        .from("comments")
        .insert({
          task_id: liveTaskId,
          user_id: ownerUserId,
          text: `F192 Comment ${uniqueSuffix}`,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (commentErr || !comment) {
        throw new Error(`Failed to create test comment: ${commentErr?.message}`);
      }
      createdCommentIds.push(comment.id);
      return comment.id as string;
    }

    it("test_AS_348_an_owner_can_purge_a_task_after_typed_confirmation", async () => {
      const { purgeTrashItem, PURGE_CONFIRMATION_PHRASE } = await import(
        "@/lib/actions/purge"
      );
      const { taskId } = await makeDeletedTask(false);

      currentTestUserId = ownerUserId;

      // Without confirmation, purge is rejected — the confirmation gate.
      const unconfirmed = await purgeTrashItem(taskId, "task", "");
      expect(unconfirmed.ok).toBe(false);
      const { data: stillThere } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", taskId)
        .maybeSingle();
      expect(stillThere?.id).toBe(taskId);

      // With the exact confirmation phrase, purge succeeds.
      const confirmed = await purgeTrashItem(
        taskId,
        "task",
        PURGE_CONFIRMATION_PHRASE,
      );
      expect(confirmed.ok).toBe(true);
    });

    it("test_AS_348_a_non_admin_cannot_purge_even_calling_the_action_directly", async () => {
      const { purgeTrashItem, PURGE_CONFIRMATION_PHRASE } = await import(
        "@/lib/actions/purge"
      );
      const { taskId } = await makeDeletedTask(false);

      // A plain member — not owner, not admin — cannot purge.
      currentTestUserId = memberUserId;
      const memberResult = await purgeTrashItem(
        taskId,
        "task",
        PURGE_CONFIRMATION_PHRASE,
      );
      expect(memberResult.ok).toBe(false);

      // An admin (but not owner) also cannot purge — canPurge is
      // deliberately owner-only (lib/auth/permissions.ts).
      currentTestUserId = adminUserId;
      const adminResult = await purgeTrashItem(
        taskId,
        "task",
        PURGE_CONFIRMATION_PHRASE,
      );
      expect(adminResult.ok).toBe(false);

      const { data: stillThere } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", taskId)
        .maybeSingle();
      expect(stillThere?.id).toBe(taskId);
    });

    it("test_AS_349_a_purged_task_is_gone_from_the_db_with_its_dependent_rows_and_storage_object", async () => {
      const { purgeTrashItem, PURGE_CONFIRMATION_PHRASE } = await import(
        "@/lib/actions/purge"
      );
      const { taskId, objectPath } = await makeDeletedTask(true);

      currentTestUserId = ownerUserId;
      const result = await purgeTrashItem(
        taskId,
        "task",
        PURGE_CONFIRMATION_PHRASE,
      );
      expect(result.ok).toBe(true);

      // The task row genuinely no longer exists (not just soft-deleted
      // again).
      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", taskId)
        .maybeSingle();
      expect(taskRow).toBeNull();

      // Dependent rows are gone too.
      const { data: checklistRows } = await adminClient
        .from("checklist_items")
        .select("id")
        .eq("task_id", taskId);
      expect(checklistRows ?? []).toHaveLength(0);

      const { data: assigneeRows } = await adminClient
        .from("task_assignees")
        .select("task_id")
        .eq("task_id", taskId);
      expect(assigneeRows ?? []).toHaveLength(0);

      const { data: attachmentRows } = await adminClient
        .from("attachments")
        .select("id")
        .eq("task_id", taskId);
      expect(attachmentRows ?? []).toHaveLength(0);

      // The Storage object is actually gone too — checked via the real
      // Storage API, not just assumed.
      expect(objectPath).not.toBeNull();
      const { data: listing } = await adminClient.storage
        .from(BUCKET)
        .list(taskId, { search: objectPath!.split("/").pop() });
      expect(listing?.length ?? 0).toBe(0);
    });

    it("test_AS_349_a_purged_comment_is_gone_from_the_db", async () => {
      const { purgeTrashItem, PURGE_CONFIRMATION_PHRASE } = await import(
        "@/lib/actions/purge"
      );
      const commentId = await makeDeletedComment();

      currentTestUserId = ownerUserId;
      const result = await purgeTrashItem(
        commentId,
        "comment",
        PURGE_CONFIRMATION_PHRASE,
      );
      expect(result.ok).toBe(true);

      const { data: commentRow } = await adminClient
        .from("comments")
        .select("id")
        .eq("id", commentId)
        .maybeSingle();
      expect(commentRow).toBeNull();
    });

    it("never allows purging a live (not soft-deleted) row, even as the owner", async () => {
      const { purgeTrashItem, PURGE_CONFIRMATION_PHRASE } = await import(
        "@/lib/actions/purge"
      );
      const liveTaskId = await makeLiveTask();

      currentTestUserId = ownerUserId;
      const result = await purgeTrashItem(
        liveTaskId,
        "task",
        PURGE_CONFIRMATION_PHRASE,
      );
      expect(result.ok).toBe(false);

      const { data: stillThere } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", liveTaskId)
        .maybeSingle();
      expect(stillThere?.id).toBe(liveTaskId);
      expect(stillThere?.deleted_at).toBeNull();
    });

    it("purging one task does not affect another deleted task", async () => {
      const { purgeTrashItem, PURGE_CONFIRMATION_PHRASE } = await import(
        "@/lib/actions/purge"
      );
      const { taskId: targetId } = await makeDeletedTask(false);
      const { taskId: untouchedId } = await makeDeletedTask(false);

      currentTestUserId = ownerUserId;
      const result = await purgeTrashItem(
        targetId,
        "task",
        PURGE_CONFIRMATION_PHRASE,
      );
      expect(result.ok).toBe(true);

      const { data: untouchedRow } = await adminClient
        .from("tasks")
        .select("id")
        .eq("id", untouchedId)
        .maybeSingle();
      expect(untouchedRow?.id).toBe(untouchedId);
    });
  },
);
