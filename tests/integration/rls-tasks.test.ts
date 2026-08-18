// Integration test for F034 RLS on `tasks` (AS-062).
//
// Verifies against the real linked Supabase project that:
//  - a member of the workspace that owns the task's project can
//    SELECT/INSERT/UPDATE tasks in that project
//  - a signed-in user who is NOT a member of that workspace cannot view a
//    task belonging to it, including via a join-style query on project_id
//    (AS-062)
//  - the anon/publishable key with no session reading `tasks` returns zero
//    rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment — but runs for real whenever `.env` is populated, which is the
// case in this repo. Mirrors tests/integration/rls-projects.test.ts (F025).

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

describe.skipIf(!haveCoreCreds)("RLS on tasks (F034) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-062: anon/publishable key with no session reading tasks returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("tasks").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS on tasks — member vs non-member of the owning project's workspace (F034)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
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

      // Workspace A + an active member of it.
      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F034 RLS workspace A", slug: `f034-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      memberAEmail = `f034-member-a-${uniqueSuffix}@example.com`;
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

      // A project belonging to workspace A, seeded via the secret-key client.
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F034 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      // A task belonging to project A, seeded via the secret-key client
      // (bypasses RLS by design, standing in for "already exists").
      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F034 RLS test task", author_id: memberAUserId })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

      // Workspace B, used only so the non-member has *some* workspace context
      // and to prove cross-workspace isolation, not just "no workspace at all".
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F034 RLS workspace B", slug: `f034-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      nonMemberEmail = `f034-nonmember-${uniqueSuffix}@example.com`;
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
      // Non-member is an active member of workspace B only — never workspace A.
      const { error: nonMemberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: nonMemberAuth.user.id,
        role: "owner",
        status: "active",
      });
      if (nonMemberInsertErr) {
        throw new Error(`Failed to seed non-member's workspace-B membership: ${nonMemberInsertErr.message}`);
      }

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

    it("a member of workspace A can SELECT workspace A's task", async () => {
      const { data, error } = await memberAClient
        .from("tasks")
        .select("id, title, project_id")
        .eq("id", taskAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(taskAId);
    });

    it("a member of workspace A can INSERT a new task into project A", async () => {
      const { data, error } = await memberAClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F034 member-created task", author_id: memberAUserId })
        .select("id, project_id")
        .single();
      expect(error).toBeNull();
      expect(data?.project_id).toBe(projectAId);
      if (data?.id) {
        await adminClient.from("tasks").delete().eq("id", data.id);
      }
    });

    it("a member of workspace A can UPDATE workspace A's task", async () => {
      const { data, error } = await memberAClient
        .from("tasks")
        .update({ description: "updated by member A" })
        .eq("id", taskAId)
        .select("id, description")
        .single();
      expect(error).toBeNull();
      expect(data?.description).toBe("updated by member A");
    });

    it("AS-062: a non-member cannot INSERT a task claiming a project_id in a workspace they don't belong to", async () => {
      const { error } = await nonMemberClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "should be rejected" });
      expect(error).not.toBeNull();
    });

    it("AS-062: a user not a member of the task's workspace gets zero rows querying the task directly", async () => {
      const { data, error } = await nonMemberClient
        .from("tasks")
        .select("*")
        .eq("id", taskAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-062: a non-member gets zero rows via a join-style query on project_id (tasks -> projects)", async () => {
      const { data, error } = await nonMemberClient
        .from("tasks")
        .select("id, title, projects(id, name)")
        .eq("id", taskAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-062: a non-member cannot UPDATE workspace A's task", async () => {
      const { data, error } = await nonMemberClient
        .from("tasks")
        .update({ description: "should not be applied" })
        .eq("id", taskAId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // Confirm via the admin client that the row was left untouched.
      const { data: unchanged } = await adminClient
        .from("tasks")
        .select("description")
        .eq("id", taskAId)
        .single();
      expect(unchanged?.description).not.toBe("should not be applied");
    });

    it("AS-062/AS-139: selecting tasks by project_id without workspace membership returns zero rows, even with a valid session in workspace B", async () => {
      const { data, error } = await nonMemberClient
        .from("tasks")
        .select("*")
        .eq("project_id", projectAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
