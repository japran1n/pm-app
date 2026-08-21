// Integration test for F058 RLS on `comments` (AS-104).
//
// Verifies against the real linked Supabase project that:
//  - a member of the workspace that owns the comment's task (via
//    task -> project -> workspace) can SELECT/INSERT comments on that task
//  - a signed-in user who is NOT a member of that workspace cannot view a
//    comment belonging to it, including via a join-style query on task_id
//    (AS-104)
//  - the anon/publishable key with no session reading `comments` returns
//    zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment — but runs for real whenever `.env` is populated, which is the
// case in this repo. Mirrors tests/integration/rls-tasks.test.ts (F034).

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
    "F278: missing Supabase credentials required to run this suite in CI (haveCoreCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveCoreCreds)("RLS on comments (F058) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-104: anon/publishable key with no session reading comments returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("comments").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS on comments — member vs non-member of the owning task's workspace (F058)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
    let commentAId: string;
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
        .insert({ name: "F058 RLS workspace A", slug: `f058-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B, used only to hold the non-member's own membership so
      // they have a valid session in *some* workspace (AS-104 requires the
      // isolation to hold even then).
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F058 RLS workspace B", slug: `f058-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      memberAEmail = `f058-member-a-${uniqueSuffix}@example.com`;
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

      nonMemberEmail = `f058-nonmember-${uniqueSuffix}@example.com`;
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

      // A project belonging to workspace A, seeded via the secret-key client.
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F058 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      // A task belonging to project A, seeded via the secret-key client.
      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F058 RLS test task", author_id: memberAUserId })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

      // A comment on task A, seeded via the secret-key client.
      const { data: commentA, error: commentAErr } = await adminClient
        .from("comments")
        .insert({ task_id: taskAId, user_id: memberAUserId, text: "F058 seeded comment" })
        .select("id")
        .single();
      if (commentAErr || !commentA) {
        throw new Error(`Failed to seed comment A: ${commentAErr?.message}`);
      }
      commentAId = commentA.id;

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
      if (commentAId) {
        await adminClient.from("comments").delete().eq("id", commentAId);
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

    it("a member of workspace A can SELECT workspace A's comment", async () => {
      const { data, error } = await memberAClient
        .from("comments")
        .select("id, text, task_id")
        .eq("id", commentAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(commentAId);
    });

    it("a member of workspace A can INSERT a new comment on task A", async () => {
      const { data, error } = await memberAClient
        .from("comments")
        .insert({ task_id: taskAId, user_id: memberAUserId, text: "F058 member-created comment" })
        .select("id, task_id")
        .single();
      expect(error).toBeNull();
      expect(data?.task_id).toBe(taskAId);
      if (data?.id) {
        await adminClient.from("comments").delete().eq("id", data.id);
      }
    });

    it("an empty (whitespace-only) comment is rejected at the database level", async () => {
      const { error } = await memberAClient
        .from("comments")
        .insert({ task_id: taskAId, user_id: memberAUserId, text: "   " });
      expect(error).not.toBeNull();
    });

    it("AS-104: a non-member cannot INSERT a comment claiming a task_id in a workspace they don't belong to", async () => {
      const { error } = await nonMemberClient
        .from("comments")
        .insert({ task_id: taskAId, user_id: memberAUserId, text: "should be rejected" });
      expect(error).not.toBeNull();
    });

    it("AS-104: a user not a member of the comment's task's workspace gets zero rows querying the comment directly", async () => {
      const { data, error } = await nonMemberClient
        .from("comments")
        .select("*")
        .eq("id", commentAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-104: a non-member gets zero rows via a join-style query on task_id (comments -> tasks)", async () => {
      const { data, error } = await nonMemberClient
        .from("comments")
        .select("id, text, tasks(id, title)")
        .eq("id", commentAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-104: full list query scoped to task A returns zero rows for a non-member, even with a valid session in workspace B", async () => {
      const { data, error } = await nonMemberClient
        .from("comments")
        .select("*")
        .eq("task_id", taskAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
