// Integration test for F108 RLS on `time_entries` (AS-161, AS-162, AS-163).
//
// Verifies against the real linked Supabase project that:
//  - a workspace member (via task -> project -> workspace) can INSERT/SELECT
//    time entries on that task
//  - a signed-in user who is NOT a member of that workspace cannot view a
//    time entry belonging to it, including via a join-style query on
//    task_id, and cannot insert one either (AS-163)
//  - the anon/publishable key with no session reading `time_entries`
//    returns zero rows, not an error
//  - a direct insert of a zero or negative `minutes` value is rejected at
//    the database level (CHECK constraint), bypassing app-level validation
//    (AS-162)
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment — but runs for real whenever `.env` is populated, which is
// the case in this repo. Mirrors tests/integration/rls-comments.test.ts
// (F058).

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

describe.skipIf(!haveCoreCreds)("RLS on time_entries (F108) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-163/AS-176: anon/publishable key with no session reading time_entries returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("time_entries").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS on time_entries — member vs non-member of the owning task's workspace (F108)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
    let entryAId: string;
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
        .insert({ name: "F108 RLS workspace A", slug: `f108-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B, used only to hold the non-member's own membership so
      // they have a valid session in *some* workspace (AS-163/AS-176
      // require the isolation to hold even then).
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F108 RLS workspace B", slug: `f108-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      memberAEmail = `f108-member-a-${uniqueSuffix}@example.com`;
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

      nonMemberEmail = `f108-nonmember-${uniqueSuffix}@example.com`;
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
        throw new Error(
          `Failed to seed non-member membership in workspace B: ${nonMemberInsertErr.message}`,
        );
      }

      // A project belonging to workspace A, seeded via the secret-key client.
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F108 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      // A task belonging to project A, seeded via the secret-key client.
      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F108 RLS test task", author_id: memberAUserId })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

      // A time entry on task A, seeded via the secret-key client.
      const { data: entryA, error: entryAErr } = await adminClient
        .from("time_entries")
        .insert({ task_id: taskAId, user_id: memberAUserId, minutes: 30 })
        .select("id")
        .single();
      if (entryAErr || !entryA) {
        throw new Error(`Failed to seed time entry A: ${entryAErr?.message}`);
      }
      entryAId = entryA.id;

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
      if (entryAId) {
        await adminClient.from("time_entries").delete().eq("id", entryAId);
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

    it("AS-161: a member of workspace A can INSERT a manual time entry on task A", async () => {
      const { data, error } = await memberAClient
        .from("time_entries")
        .insert({
          task_id: taskAId,
          user_id: memberAUserId,
          minutes: 45,
          billable: true,
          note: "F108 member-created entry",
        })
        .select("id, task_id, minutes")
        .single();
      expect(error).toBeNull();
      expect(data?.task_id).toBe(taskAId);
      expect(data?.minutes).toBe(45);
      if (data?.id) {
        await adminClient.from("time_entries").delete().eq("id", data.id);
      }
    });

    it("AS-161: a member of workspace A can SELECT workspace A's time entry", async () => {
      const { data, error } = await memberAClient
        .from("time_entries")
        .select("id, minutes, task_id")
        .eq("id", entryAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(entryAId);
    });

    it("AS-162: a direct insert with minutes = 0 is rejected at the database level (CHECK constraint)", async () => {
      const { error } = await memberAClient
        .from("time_entries")
        .insert({ task_id: taskAId, user_id: memberAUserId, minutes: 0 });
      expect(error).not.toBeNull();
    });

    it("AS-162: a direct insert with negative minutes is rejected at the database level (CHECK constraint)", async () => {
      const { error } = await memberAClient
        .from("time_entries")
        .insert({ task_id: taskAId, user_id: memberAUserId, minutes: -15 });
      expect(error).not.toBeNull();
    });

    it("AS-163: a non-member cannot INSERT a time entry claiming a task_id in a workspace they don't belong to", async () => {
      const { error } = await nonMemberClient
        .from("time_entries")
        .insert({ task_id: taskAId, user_id: memberAUserId, minutes: 20 });
      expect(error).not.toBeNull();
    });

    it("AS-163: a non-member gets zero rows querying the time entry directly, even with a valid session in workspace B", async () => {
      const { data, error } = await nonMemberClient
        .from("time_entries")
        .select("*")
        .eq("id", entryAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-163: a non-member gets zero rows via a join-style query on task_id (time_entries -> tasks)", async () => {
      const { data, error } = await nonMemberClient
        .from("time_entries")
        .select("id, minutes, tasks(id, title)")
        .eq("id", entryAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-163: full list query scoped to task A returns zero rows for a non-member", async () => {
      const { data, error } = await nonMemberClient
        .from("time_entries")
        .select("*")
        .eq("task_id", taskAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
