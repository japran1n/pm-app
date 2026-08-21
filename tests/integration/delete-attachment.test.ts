// Integration test for F067 (AS-110, AS-111, AS-114), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/delete-comment.test.ts and
// tests/integration/upload-attachment.test.ts.
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
  }),
}));

const BUCKET = "task-attachments";

describe.skipIf(!haveAdminCreds)(
  "deleteAttachment (F067: AS-110, AS-111, AS-114)",
  () => {
    let adminClient: SupabaseClient;
    const createdAttachmentIds: string[] = [];
    const createdObjectPaths: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let uploaderUserId: string;
    let otherMemberUserId: string;
    let adminUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F067 Test Workspace",
          slug: `f067-attachments-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function makeUser(label: string) {
        const email = `f067-${label}-${uniqueSuffix}@example.com`;
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

      // The attachment's uploader (a plain member).
      uploaderUserId = await makeUser("uploader");
      // A different plain member of the same workspace — NOT the
      // uploader, NOT an admin/owner. Used to prove AS-111.
      otherMemberUserId = await makeUser("other-member");
      // An admin of the same workspace. Used to prove AS-110's admin case.
      adminUserId = await makeUser("admin");

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: uploaderUserId,
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
          name: `F067 Project ${uniqueSuffix}`,
          created_by: uploaderUserId,
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
          title: `F067 Task ${uniqueSuffix}`,
          author_id: uploaderUserId,
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
      if (createdObjectPaths.length) {
        await adminClient.storage.from(BUCKET).remove(createdObjectPaths);
      }
      for (const attachmentId of createdAttachmentIds) {
        await adminClient.from("attachments").delete().eq("id", attachmentId);
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

    // Seeds a real row + a real Storage object, both tracked for cleanup
    // in afterAll as a fallback in case a test's own assertions don't
    // consume them (e.g. an early failure).
    async function makeAttachment(): Promise<{
      attachmentId: string;
      objectPath: string;
    }> {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const objectPath = `${taskId}/${uniqueSuffix}-notes.txt`;

      const { error: uploadError } = await adminClient.storage
        .from(BUCKET)
        .upload(objectPath, new Blob(["hello"]), {
          contentType: "text/plain",
          upsert: false,
        });
      if (uploadError) {
        throw new Error(`Failed to seed storage object: ${uploadError.message}`);
      }
      createdObjectPaths.push(objectPath);

      const { data, error } = await adminClient
        .from("attachments")
        .insert({
          task_id: taskId,
          file_url: objectPath,
          file_name: "notes.txt",
          uploaded_by: uploaderUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed attachment row: ${error?.message}`);
      }
      createdAttachmentIds.push(data.id);
      return { attachmentId: data.id, objectPath };
    }

    it("AS-110: the attachment's own uploader can delete their own attachment — row AND storage object both gone", async () => {
      const { deleteAttachment } = await import("@/lib/actions/attachments");
      const { attachmentId, objectPath } = await makeAttachment();

      currentTestUserId = uploaderUserId;
      const result = await deleteAttachment(attachmentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.id).toBe(attachmentId);

      // Row is gone (hard delete, unlike comments' soft delete).
      const { data: row } = await adminClient
        .from("attachments")
        .select("id")
        .eq("id", attachmentId)
        .maybeSingle();
      expect(row).toBeNull();

      // Storage object is gone too — AS-114: no orphaned file left behind.
      const { data: listing } = await adminClient.storage
        .from(BUCKET)
        .list(taskId, { search: objectPath.split("/").pop() });
      expect(listing?.length ?? 0).toBe(0);
    });

    it("AS-110: a workspace admin/owner can delete another member's attachment", async () => {
      const { deleteAttachment } = await import("@/lib/actions/attachments");
      const { attachmentId, objectPath } = await makeAttachment(); // uploaded by uploaderUserId

      currentTestUserId = adminUserId;
      const result = await deleteAttachment(attachmentId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { data: row } = await adminClient
        .from("attachments")
        .select("id")
        .eq("id", attachmentId)
        .maybeSingle();
      expect(row).toBeNull();

      const { data: listing } = await adminClient.storage
        .from(BUCKET)
        .list(taskId, { search: objectPath.split("/").pop() });
      expect(listing?.length ?? 0).toBe(0);
    });

    it("AS-111: a different regular member (not uploader, not admin/owner) cannot delete someone else's attachment", async () => {
      const { deleteAttachment } = await import("@/lib/actions/attachments");
      const { attachmentId, objectPath } = await makeAttachment(); // uploaded by uploaderUserId

      currentTestUserId = otherMemberUserId;
      const result = await deleteAttachment(attachmentId);

      expect(result.ok).toBe(false);

      // Side-effect check: neither the row nor the storage object was
      // touched.
      const { data: row } = await adminClient
        .from("attachments")
        .select("id")
        .eq("id", attachmentId)
        .maybeSingle();
      expect(row?.id).toBe(attachmentId);

      const { data: listing } = await adminClient.storage
        .from(BUCKET)
        .list(taskId, { search: objectPath.split("/").pop() });
      expect(listing?.length ?? 0).toBe(1);
    });

    it("AS-110/AS-111 side effect: deleting one attachment does not affect another attachment on the same task", async () => {
      const { deleteAttachment } = await import("@/lib/actions/attachments");
      const { attachmentId } = await makeAttachment();
      const { attachmentId: untouchedId } = await makeAttachment();

      currentTestUserId = uploaderUserId;
      const result = await deleteAttachment(attachmentId);
      expect(result.ok).toBe(true);

      const { data: untouchedRow } = await adminClient
        .from("attachments")
        .select("id")
        .eq("id", untouchedId)
        .maybeSingle();
      expect(untouchedRow?.id).toBe(untouchedId);
    });

    it("an already-deleted attachment is treated as not found by deleteAttachment (idempotent-safe)", async () => {
      const { deleteAttachment } = await import("@/lib/actions/attachments");
      const { attachmentId } = await makeAttachment();

      currentTestUserId = uploaderUserId;
      const first = await deleteAttachment(attachmentId);
      expect(first.ok).toBe(true);

      const second = await deleteAttachment(attachmentId);
      expect(second.ok).toBe(false);
    });
  },
);
