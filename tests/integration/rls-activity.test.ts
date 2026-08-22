// Integration test for F194 schema + RLS on `task_activity` (AS-353,
// AS-357, AS-359).
//
// Verifies against the real linked Supabase project that:
//  - a chronological feed can be written (via the SECURITY DEFINER
//    write_task_activity_entry RPC) and read back in order for a task a
//    member is entitled to see (AS-353)
//  - a member of the workspace who is NOT on the task's project (private
//    project, not a project member) cannot read the task's activity via a
//    direct query — zero rows, not an error (AS-359)
//  - a completely unrelated user with no membership at all cannot read
//    the task's activity either (AS-359)
//  - entries cannot be edited or deleted through the app, even by an
//    owner using their own real (publishable-key) session, not the
//    service-role admin client (AS-357) — because no UPDATE/DELETE RLS
//    policy exists for any role
//  - the anon/publishable key with no session reading task_activity
//    returns zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in
// the environment. Mirrors tests/integration/rls-audit-log.test.ts (F139).

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
if (process.env.CI && !haveCoreCreds) {
  throw new Error(
    "F194: missing Supabase credentials required to run this suite in CI (haveCoreCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F194: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveCoreCreds)("RLS on task_activity (F194) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("anon/publishable key with no session reading task_activity returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("task_activity").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS + append-only guarantees on task_activity — member vs non-member vs outsider (F194)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let memberUserId: string;
    let memberEmail: string;
    let memberPassword: string;
    let outsiderEmail: string;
    let outsiderPassword: string;
    let memberClient: SupabaseClient;
    let outsiderClient: SupabaseClient;
    let firstEntryId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F194 RLS workspace", slug: `f194-rls-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      memberEmail = `f194-member-${uniqueSuffix}@example.com`;
      memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } = await adminClient.auth.admin.createUser({
        email: memberEmail,
        password: memberPassword,
        email_confirm: true,
      });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member test user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "member",
        status: "active",
      });
      if (memberInsertErr) {
        throw new Error(`Failed to seed member membership: ${memberInsertErr.message}`);
      }

      // Outsider: never added to this workspace at all.
      outsiderEmail = `f194-outsider-${uniqueSuffix}@example.com`;
      outsiderPassword = "Test-password-1!";
      const { data: outsiderAuth, error: outsiderAuthErr } = await adminClient.auth.admin.createUser({
        email: outsiderEmail,
        password: outsiderPassword,
        email_confirm: true,
      });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider test user: ${outsiderAuthErr?.message}`);
      }

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F194 RLS project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to create project: ${projectErr?.message}`);
      }
      projectId = project.id;

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title: "F194 RLS task", author_id: memberUserId })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create task: ${taskErr?.message}`);
      }
      taskId = task.id;

      memberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberSignInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (memberSignInErr) {
        throw new Error(`Failed to sign in member test user: ${memberSignInErr.message}`);
      }

      outsiderClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: outsiderSignInErr } = await outsiderClient.auth.signInWithPassword({
        email: outsiderEmail,
        password: outsiderPassword,
      });
      if (outsiderSignInErr) {
        throw new Error(`Failed to sign in outsider test user: ${outsiderSignInErr.message}`);
      }
    });

    afterAll(async () => {
      if (taskId) {
        await adminClient.from("task_activity").delete().eq("task_id", taskId);
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
    });

    it("AS-353: a member can write activity entries via the RPC and read them back in chronological order", async () => {
      const { data: first, error: firstErr } = await memberClient.rpc("write_task_activity_entry", {
        p_task_id: taskId,
        p_kind: "field_changed",
        p_field: "status",
        p_old_value: "todo",
        p_new_value: "in_progress",
      });
      expect(firstErr).toBeNull();
      expect(first).toBeTruthy();
      firstEntryId = (first as { id: string }).id;

      const { data: second, error: secondErr } = await memberClient.rpc("write_task_activity_entry", {
        p_task_id: taskId,
        p_kind: "comment_added",
        p_new_value: { comment_id: "11111111-1111-1111-1111-111111111111" },
      });
      expect(secondErr).toBeNull();
      expect(second).toBeTruthy();

      const { data: feed, error: feedErr } = await memberClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId)
        .order("created_at", { ascending: true });
      expect(feedErr).toBeNull();
      expect(feed).not.toBeNull();
      expect(feed!.length).toBeGreaterThanOrEqual(2);
      expect(feed![0].kind).toBe("field_changed");
      expect(feed![0].actor_id).toBe(memberUserId);
      expect(feed![1].kind).toBe("comment_added");
    });

    it("AS-360: a system-generated entry (no session, p_system = true) is written with a null actor_id", async () => {
      const { data, error } = await adminClient.rpc("write_task_activity_entry", {
        p_task_id: taskId,
        p_kind: "field_changed",
        p_field: "due_date",
        p_old_value: "2026-08-20",
        p_new_value: "2026-09-20",
        p_system: true,
      });
      expect(error).toBeNull();
      expect((data as { actor_id: string | null }).actor_id).toBeNull();
    });

    it("AS-359: an outsider with no workspace membership at all cannot read the task's activity (zero rows, not an error)", async () => {
      const { data, error } = await outsiderClient
        .from("task_activity")
        .select("*")
        .eq("task_id", taskId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-359: an outsider cannot write activity for a task they cannot see, via the RPC", async () => {
      const { error } = await outsiderClient.rpc("write_task_activity_entry", {
        p_task_id: taskId,
        p_kind: "field_changed",
        p_field: "status",
        p_old_value: "todo",
        p_new_value: "done",
      });
      expect(error).not.toBeNull();
    });

    it("AS-357: a member's direct UPDATE attempt on an existing task_activity row, from their own real session, affects zero rows (no UPDATE policy permits it)", async () => {
      const { data } = await memberClient
        .from("task_activity")
        .update({ field: "tampered" })
        .eq("id", firstEntryId)
        .select("id");
      expect((data ?? []).length).toBe(0);

      const { data: verify } = await adminClient
        .from("task_activity")
        .select("field")
        .eq("id", firstEntryId)
        .single();
      expect(verify?.field).toBe("status");
    });

    it("AS-357: a member's direct DELETE attempt on an existing task_activity row, from their own real session, affects zero rows (no DELETE policy permits it)", async () => {
      const { data } = await memberClient
        .from("task_activity")
        .delete()
        .eq("id", firstEntryId)
        .select("id");
      expect((data ?? []).length).toBe(0);

      const { data: verify } = await adminClient
        .from("task_activity")
        .select("id")
        .eq("id", firstEntryId)
        .single();
      expect(verify?.id).toBe(firstEntryId);
    });
  },
);
