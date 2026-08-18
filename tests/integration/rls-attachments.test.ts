// Integration test for F064 attachments schema + Storage RLS (AS-106, AS-107).
//
// Verifies against the real linked Supabase project that:
//  - the `task-attachments` bucket is private (not publicly listable/readable)
//  - a member of the workspace that owns the attachment's task (via
//    task -> project -> workspace) can SELECT/INSERT `attachments` rows and
//    can read the underlying Storage object via a signed URL
//  - a signed-in user who is NOT a member of that workspace cannot view the
//    attachments row and cannot generate a working signed URL for the file,
//    even when they know (guess) the exact storage path (AS-107)
//  - the anon/publishable key with no session reading `attachments` returns
//    zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment. Mirrors tests/integration/rls-comments.test.ts (F058).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

const haveCoreCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

const BUCKET = "task-attachments";

describe.skipIf(!haveCoreCreds)("RLS on attachments (F064) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-106: anon/publishable key with no session reading attachments returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("attachments").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("AS-106: anon key cannot list objects in the task-attachments bucket", async () => {
    const { data, error } = await anonClient.storage.from(BUCKET).list("");
    // Private bucket: either an error, or an empty listing — never actual
    // objects returned to an unauthenticated caller.
    if (!error) {
      expect(data).toEqual([]);
    }
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS on attachments + Storage — member vs non-member of the owning task's workspace (F064)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
    let attachmentAId: string;
    let objectPath: string;
    let memberAUserId: string;
    let memberAEmail: string;
    let memberAPassword: string;
    let nonMemberEmail: string;
    let nonMemberPassword: string;
    let memberAClient: SupabaseClient;
    let nonMemberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Confirm the bucket exists and is private (AS-106).
      const { data: bucket, error: bucketErr } = await adminClient.storage.getBucket(BUCKET);
      if (bucketErr || !bucket) {
        throw new Error(`Expected bucket '${BUCKET}' to exist: ${bucketErr?.message}`);
      }
      expect(bucket.public).toBe(false);

      // Workspace A + an active member of it.
      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F064 RLS workspace A", slug: `f064-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B, used only to hold the non-member's own membership so
      // they have a valid session in *some* workspace (AS-107 requires the
      // isolation to hold even then).
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F064 RLS workspace B", slug: `f064-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      memberAEmail = `f064-member-a-${uniqueSuffix}@example.com`;
      memberAPassword = "Test-password-1!";
      const { data: memberAAuth, error: memberAAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberAEmail,
          password: memberAPassword,
          email_confirm: true,
        });
      if (memberAAuthErr || !memberAAuth.user) {
        throw new Error(`Failed to create member-A test user: ${memberAAuthErr?.message}`);
      }
      memberAUserId = memberAAuth.user.id;

      const { error: memberAInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: memberAUserId,
        role: "owner",
        status: "active",
      });
      if (memberAInsertErr) {
        throw new Error(`Failed to seed member-A membership: ${memberAInsertErr.message}`);
      }

      nonMemberEmail = `f064-nonmember-${uniqueSuffix}@example.com`;
      nonMemberPassword = "Test-password-1!";
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: nonMemberPassword,
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(`Failed to create non-member test user: ${nonMemberAuthErr?.message}`);
      }

      const { error: nonMemberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: nonMemberAuth.user.id,
        role: "owner",
        status: "active",
      });
      if (nonMemberInsertErr) {
        throw new Error(`Failed to seed non-member membership in workspace B: ${nonMemberInsertErr.message}`);
      }

      // A project + task belonging to workspace A, seeded via the secret-key client.
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F064 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F064 RLS test task", author_id: memberAUserId })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

      // Upload a real object to Storage at {task_id}/{filename}, using the
      // admin (service-role) client — bypasses RLS, mirrors how F065's
      // server-side upload flow will write the object.
      objectPath = `${taskAId}/f064-test-file.txt`;
      const { error: uploadErr } = await adminClient.storage
        .from(BUCKET)
        .upload(objectPath, new Blob(["hello attachment"], { type: "text/plain" }), {
          upsert: true,
        });
      if (uploadErr) {
        throw new Error(`Failed to seed storage object: ${uploadErr.message}`);
      }

      // The corresponding attachments row (file_url stores the object path).
      const { data: attachmentA, error: attachmentAErr } = await adminClient
        .from("attachments")
        .insert({
          task_id: taskAId,
          file_url: objectPath,
          file_name: "f064-test-file.txt",
          uploaded_by: memberAUserId,
        })
        .select("id")
        .single();
      if (attachmentAErr || !attachmentA) {
        throw new Error(`Failed to seed attachment A: ${attachmentAErr?.message}`);
      }
      attachmentAId = attachmentA.id;

      memberAClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberASignInErr } = await memberAClient.auth.signInWithPassword({
        email: memberAEmail,
        password: memberAPassword,
      });
      if (memberASignInErr) {
        throw new Error(`Failed to sign in member-A test user: ${memberASignInErr.message}`);
      }

      nonMemberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: nonMemberSignInErr } = await nonMemberClient.auth.signInWithPassword({
        email: nonMemberEmail,
        password: nonMemberPassword,
      });
      if (nonMemberSignInErr) {
        throw new Error(`Failed to sign in non-member test user: ${nonMemberSignInErr.message}`);
      }
    });

    afterAll(async () => {
      // Best-effort cleanup so re-runs stay clean.
      if (objectPath) {
        await adminClient.storage.from(BUCKET).remove([objectPath]);
      }
      if (attachmentAId) {
        await adminClient.from("attachments").delete().eq("id", attachmentAId);
      }
      if (taskAId) {
        await adminClient.from("tasks").delete().eq("id", taskAId);
      }
      if (projectAId) {
        await adminClient.from("projects").delete().eq("id", projectAId);
      }
      if (workspaceAId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceAId);
        await adminClient.from("workspaces").delete().eq("id", workspaceAId);
      }
      if (workspaceBId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceBId);
        await adminClient.from("workspaces").delete().eq("id", workspaceBId);
      }
      if (memberAUserId) {
        await adminClient.auth.admin.deleteUser(memberAUserId);
      }
      if (nonMemberClient) {
        const { data } = await nonMemberClient.auth.getUser();
        if (data.user) {
          await adminClient.auth.admin.deleteUser(data.user.id);
        }
      }
    });

    it("a member of workspace A can SELECT workspace A's attachment row", async () => {
      const { data, error } = await memberAClient
        .from("attachments")
        .select("id, file_name, task_id")
        .eq("id", attachmentAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(attachmentAId);
    });

    it("a member of workspace A can INSERT a new attachment row on task A", async () => {
      const { data, error } = await memberAClient
        .from("attachments")
        .insert({
          task_id: taskAId,
          file_url: `${taskAId}/f064-member-created.txt`,
          file_name: "f064-member-created.txt",
          uploaded_by: memberAUserId,
        })
        .select("id, task_id")
        .single();
      expect(error).toBeNull();
      expect(data?.task_id).toBe(taskAId);
      if (data?.id) {
        await adminClient.from("attachments").delete().eq("id", data.id);
      }
    });

    it("AS-107: a member of workspace A can generate a working signed URL for the object", async () => {
      const { data, error } = await memberAClient.storage
        .from(BUCKET)
        .createSignedUrl(objectPath, 60);
      expect(error).toBeNull();
      expect(data?.signedUrl).toBeTruthy();

      // The signed URL actually works.
      const res = await fetch(data!.signedUrl);
      expect(res.ok).toBe(true);
    });

    it("AS-106/AS-107: a non-member cannot INSERT an attachments row claiming a task_id in a workspace they don't belong to", async () => {
      const { error } = await nonMemberClient.from("attachments").insert({
        task_id: taskAId,
        file_url: `${taskAId}/f064-nonmember-attempt.txt`,
        file_name: "f064-nonmember-attempt.txt",
        uploaded_by: memberAUserId,
      });
      expect(error).not.toBeNull();
    });

    it("AS-107: a non-member gets zero rows querying the attachment directly", async () => {
      const { data, error } = await nonMemberClient
        .from("attachments")
        .select("*")
        .eq("id", attachmentAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-107: a non-member cannot generate a working signed URL for the file, even knowing the exact storage path", async () => {
      const { data, error } = await nonMemberClient.storage
        .from(BUCKET)
        .createSignedUrl(objectPath, 60);
      // Storage RLS denies the underlying SELECT on storage.objects, so
      // createSignedUrl fails outright for a non-member.
      expect(error).not.toBeNull();
      expect(data).toBeNull();
    });

    it("AS-107: a non-member cannot upload directly into task A's path prefix", async () => {
      const { error } = await nonMemberClient.storage
        .from(BUCKET)
        .upload(`${taskAId}/f064-nonmember-upload.txt`, new Blob(["nope"], { type: "text/plain" }));
      expect(error).not.toBeNull();
    });
  },
);
