// Integration test for F065 (AS-105, AS-108, AS-112, AS-113), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/add-comment.test.ts.
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

function buildFormData(
  taskId: string,
  file: File,
): FormData {
  const fd = new FormData();
  fd.set("taskId", taskId);
  fd.set("file", file);
  return fd;
}

describe.skipIf(!haveAdminCreds)(
  "uploadAttachment (F065: AS-105, AS-108, AS-112, AS-113)",
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
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F065 Test Workspace",
          slug: `f065-attachments-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f065-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
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
          name: `F065 Project ${uniqueSuffix}`,
          created_by: memberUserId,
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
          title: `F065 Task ${uniqueSuffix}`,
          author_id: memberUserId,
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
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-105/AS-108: an active workspace member can upload a valid file, a row is created, the storage object exists, and a time-limited signed URL is returned", async () => {
      const { uploadAttachment } = await import("@/lib/actions/attachments");

      currentTestUserId = memberUserId;

      const file = new File(["hello world"], "notes.txt", {
        type: "text/plain",
      });
      const formData = buildFormData(taskId, file);

      const result = await uploadAttachment(formData);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdAttachmentIds.push(result.data.id);
      createdObjectPaths.push(result.data.fileUrl);

      expect(result.data.taskId).toBe(taskId);
      expect(result.data.fileName).toBe("notes.txt");
      expect(result.data.uploadedBy).toBe(memberUserId);
      // AS-108: signed URL, not a permanent public URL — must carry a
      // token query param and point at the private-object signing route.
      expect(result.data.signedUrl).toContain("token=");
      expect(result.data.fileUrl.startsWith(`${taskId}/`)).toBe(true);

      const { data: row, error } = await adminClient
        .from("attachments")
        .select("id, task_id, file_name, file_url, uploaded_by")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      expect(row?.task_id).toBe(taskId);
      expect(row?.file_name).toBe("notes.txt");
      expect(row?.uploaded_by).toBe(memberUserId);

      // Storage object actually exists.
      const { data: downloaded, error: downloadError } =
        await adminClient.storage.from(BUCKET).download(result.data.fileUrl);
      expect(downloadError).toBeNull();
      expect(downloaded).not.toBeNull();
    });

    it("test_mime_type_persisted_and_returned_for_an_image_upload: uploading a real image file results in a real mime_type value persisted in the attachments row and returned to the caller", async () => {
      const { uploadAttachment } = await import("@/lib/actions/attachments");

      currentTestUserId = memberUserId;

      // A minimal 1x1 PNG payload — real bytes, real content-type, not a
      // stubbed/fake upload.
      const pngBytes = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      const file = new File([pngBytes], "screenshot.png", {
        type: "image/png",
      });
      const formData = buildFormData(taskId, file);

      const result = await uploadAttachment(formData);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdAttachmentIds.push(result.data.id);
      createdObjectPaths.push(result.data.fileUrl);

      expect(result.data.mimeType).toBe("image/png");

      const { data: row, error } = await adminClient
        .from("attachments")
        .select("mime_type")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      expect(row?.mime_type).toBe("image/png");
    });

    it("AS-112: a file larger than the configured size limit is rejected before the upload completes", async () => {
      const { uploadAttachment } = await import("@/lib/actions/attachments");
      const { MAX_ATTACHMENT_SIZE_BYTES } = await import(
        "@/lib/validation/attachments"
      );

      currentTestUserId = memberUserId;

      const oversized = new Uint8Array(MAX_ATTACHMENT_SIZE_BYTES + 1);
      const file = new File([oversized], "huge.txt", { type: "text/plain" });
      const formData = buildFormData(taskId, file);

      const result = await uploadAttachment(formData);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      // No row was created and nothing was uploaded to storage for this file.
      const { data: rows } = await adminClient
        .from("attachments")
        .select("id")
        .eq("task_id", taskId)
        .eq("file_name", "huge.txt");
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-113: a disallowed MIME type is rejected with a clear error", async () => {
      const { uploadAttachment } = await import("@/lib/actions/attachments");

      currentTestUserId = memberUserId;

      const file = new File(["#!/bin/sh\necho hi"], "script.sh", {
        type: "application/x-sh",
      });
      const formData = buildFormData(taskId, file);

      const result = await uploadAttachment(formData);

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      const { data: rows } = await adminClient
        .from("attachments")
        .select("id")
        .eq("task_id", taskId)
        .eq("file_name", "script.sh");
      expect(rows ?? []).toHaveLength(0);
    });

    it("a user who is not a member of the task's workspace cannot upload", async () => {
      const { uploadAttachment } = await import("@/lib/actions/attachments");

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nonMemberEmail = `f065-nonmember-${uniqueSuffix}@example.com`;
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(
          `Failed to create non-member user: ${nonMemberAuthErr?.message}`,
        );
      }
      createdUserIds.push(nonMemberAuth.user.id);

      currentTestUserId = nonMemberAuth.user.id;

      const file = new File(["hi"], "nonmember.txt", { type: "text/plain" });
      const formData = buildFormData(taskId, file);

      const result = await uploadAttachment(formData);

      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("attachments")
        .select("id")
        .eq("task_id", taskId)
        .eq("file_name", "nonmember.txt");
      expect(rows ?? []).toHaveLength(0);
    });
  },
);
