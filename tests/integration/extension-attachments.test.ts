// Integration test for F294 (AS-559, AS-566, AS-567), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf/real-sign-in
// pattern established by tests/integration/extension-create-task.test.ts
// (F292) and rls-projects.test.ts, rather than mocking auth or Storage, so
// the JWT/membership/Storage-RLS checks in
// app/api/extension/attachments/route.ts are exercised for real.
//
// The route handler's POST()/OPTIONS() exports are imported and invoked
// directly with a real `NextRequest`, same convention as F292/F293's own
// Route Handler tests — no server spin-up needed for a plain fetch-free
// FormData POST.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";

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

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);

// A minimal valid 1x1 PNG (real bytes, not a fake string) — small enough to
// stay far under MAX_ATTACHMENT_SIZE_BYTES for the "real, successful
// upload" cases.
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function tinyPngFile(name = "screenshot.png"): File {
  const binary = Buffer.from(TINY_PNG_BASE64, "base64");
  return new File([binary], name, { type: "image/png" });
}

async function postExtensionAttachment(
  formData: FormData,
  token?: string,
): Promise<Response> {
  const { POST } = await import("@/app/api/extension/attachments/route");
  const request = new NextRequest(
    "http://localhost:3000/api/extension/attachments",
    {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: formData,
    },
  );
  return POST(request);
}

describe.skipIf(!haveCreds)(
  "POST /api/extension/attachments (F294: AS-559, AS-566, AS-567)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let memberUserId: string;
    let memberAccessToken: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F294 workspace", slug: `f294-ws-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F294 project" })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;

      const memberEmail = `f294-member-${suffix}@example.com`;
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
        .insert({ workspace_id: workspaceId, user_id: memberUserId, role: "owner", status: "active" });
      if (memberInsertErr) throw new Error(`Failed to seed membership: ${memberInsertErr.message}`);

      const memberSignInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { data: memberSession, error: memberSignInErr } =
        await memberSignInClient.auth.signInWithPassword({
          email: memberEmail,
          password: memberPassword,
        });
      if (memberSignInErr || !memberSession.session) {
        throw new Error(`Failed to sign in member: ${memberSignInErr?.message}`);
      }
      memberAccessToken = memberSession.session.access_token;
    });

    afterAll(async () => {
      // Best-effort cleanup: remove any attachments + Storage objects this
      // suite created, then the tasks/project/workspace/user.
      const { data: attachmentRows } = await adminClient
        .from("attachments")
        .select("id, file_url")
        .in("task_id", createdTaskIds.length ? createdTaskIds : ["00000000-0000-0000-0000-000000000000"]);
      if (attachmentRows?.length) {
        await adminClient.storage
          .from("task-attachments")
          .remove(attachmentRows.map((row) => row.file_url));
        await adminClient
          .from("attachments")
          .delete()
          .in("id", attachmentRows.map((row) => row.id));
      }
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      if (projectId) await adminClient.from("projects").delete().eq("id", projectId);
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    async function createRealTask(title: string): Promise<string> {
      const { data: task, error } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title, author_id: memberUserId, status: "todo" })
        .select("id")
        .single();
      if (error || !task) throw new Error(`Failed to seed task: ${error?.message}`);
      createdTaskIds.push(task.id);
      return task.id;
    }

    it("AS-559: uploading a real screenshot to a real task produces a real attachment row and a real Storage object, verified via admin re-query", async () => {
      const taskId = await createRealTask("F294 task with screenshot");

      const formData = new FormData();
      formData.append("taskId", taskId);
      formData.append("file", tinyPngFile());

      const res = await postExtensionAttachment(formData, memberAccessToken);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.attachment.taskId).toBe(taskId);

      // Independently re-query with the admin client — never trust the
      // route's own response as proof the row exists.
      const { data: row, error } = await adminClient
        .from("attachments")
        .select("id, task_id, file_url, uploaded_by")
        .eq("id", json.attachment.id)
        .maybeSingle();
      expect(error).toBeNull();
      expect(row?.task_id).toBe(taskId);
      expect(row?.uploaded_by).toBe(memberUserId);

      // The Storage object really exists at the recorded path — list its
      // parent "directory" (the task id) and confirm the object is there.
      const { data: listing, error: listError } = await adminClient.storage
        .from("task-attachments")
        .list(taskId);
      expect(listError).toBeNull();
      const objectName = row!.file_url.split("/").slice(1).join("/");
      expect(listing?.some((obj) => obj.name === objectName)).toBe(true);
    });

    it("AS-566: an oversized file is rejected with a message naming the actual limit, and no attachment row is created", async () => {
      const taskId = await createRealTask("F294 task, oversized attempt");

      // A file whose real byte size exceeds MAX_ATTACHMENT_SIZE_BYTES
      // (10MB) — content doesn't matter, only its .size.
      const oversized = new File(
        [new Uint8Array(10 * 1024 * 1024 + 1)],
        "too-big.png",
        { type: "image/png" },
      );

      const { count: before } = await adminClient
        .from("attachments")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId);

      const formData = new FormData();
      formData.append("taskId", taskId);
      formData.append("file", oversized);

      const res = await postExtensionAttachment(formData, memberAccessToken);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/10MB/);

      const { count: after } = await adminClient
        .from("attachments")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId);
      expect(after).toBe(before);

      // The task itself is completely unaffected — still exists, still has
      // no attachments, no partial/broken reference of any kind.
      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", taskId)
        .maybeSingle();
      expect(taskRow?.deleted_at).toBeNull();
    });

    it("AS-567: a failed upload (a real Storage-layer conflict) leaves no orphaned attachment row and does not disturb the task or the earlier successful upload", async () => {
      const taskId = await createRealTask("F294 task, forced upload conflict");

      // Force a REAL, deterministic Storage failure: upload once
      // successfully to a fixed, test-only object path (via
      // uploadAttachmentForUser's objectPathOverride escape hatch), then
      // attempt a second upload reusing the exact same path. Supabase
      // Storage's real `upsert: false` behavior rejects the second write
      // with a genuine "already exists" conflict — this is not simulated.
      const { uploadAttachmentForUser } = await import("@/lib/actions/attachments");
      const fixedPath = `${taskId}/f294-as567-fixed-path.png`;
      const firstBuffer = Buffer.from(TINY_PNG_BASE64, "base64").buffer;

      const first = await uploadAttachmentForUser(
        memberUserId,
        {
          taskId,
          fileName: "first.png",
          fileSize: firstBuffer.byteLength,
          mimeType: "image/png",
          arrayBuffer: firstBuffer as ArrayBuffer,
        },
        { objectPathOverride: fixedPath },
      );
      expect(first.ok).toBe(true);
      if (first.ok) createdTaskIds.push(taskId); // ensure cleanup covers this task's attachment too

      const { count: countAfterFirst } = await adminClient
        .from("attachments")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId);
      expect(countAfterFirst).toBe(1);

      // Second call reuses the SAME fixed path — Storage upload conflicts
      // for real, so uploadAttachmentForUser must return ok:false WITHOUT
      // ever reaching (or leaving a row from) the insert step.
      const secondBuffer = Buffer.from(TINY_PNG_BASE64, "base64").buffer;
      const second = await uploadAttachmentForUser(
        memberUserId,
        {
          taskId,
          fileName: "second.png",
          fileSize: secondBuffer.byteLength,
          mimeType: "image/png",
          arrayBuffer: secondBuffer as ArrayBuffer,
        },
        { objectPathOverride: fixedPath },
      );
      expect(second.ok).toBe(false);

      // No orphaned/duplicate row: still exactly the one attachment row
      // from the first, successful upload.
      const { data: rows, error } = await adminClient
        .from("attachments")
        .select("id, file_url")
        .eq("task_id", taskId);
      expect(error).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows?.[0]?.file_url).toBe(fixedPath);

      // The original object from the first upload is still intact (the
      // failed second attempt didn't remove or corrupt it).
      const { data: listing } = await adminClient.storage
        .from("task-attachments")
        .list(taskId);
      expect(
        listing?.some((obj) => obj.name === "f294-as567-fixed-path.png"),
      ).toBe(true);

      // The task itself remains a completely valid, undisturbed row.
      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", taskId)
        .maybeSingle();
      expect(taskRow?.deleted_at).toBeNull();
    });

    it("AS-572-equivalent: a request with no Authorization header is rejected with 401 and creates no attachment", async () => {
      const taskId = await createRealTask("F294 task, no auth");
      const formData = new FormData();
      formData.append("taskId", taskId);
      formData.append("file", tinyPngFile());

      const res = await postExtensionAttachment(formData);
      expect(res.status).toBe(401);

      const { count } = await adminClient
        .from("attachments")
        .select("id", { count: "exact", head: true })
        .eq("task_id", taskId);
      expect(count).toBe(0);
    });
  },
);
