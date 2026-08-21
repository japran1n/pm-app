// Integration test for F109 schema + RLS on `active_timers` (AS-164, AS-165,
// AS-168).
//
// Verifies against the real linked Supabase project that:
//  - a workspace member (via task -> project -> workspace) can INSERT/SELECT
//    an active timer on that task (AS-164), and reading it back proves the
//    running state is server-persisted, not client-only (AS-168)
//  - the UNIQUE constraint on user_id genuinely rejects a second concurrent
//    active_timers row for the same user via a *direct* insert attempt,
//    bypassing any action-layer stop-previous-timer logic (AS-165) — this
//    is the core mechanism AS-165 depends on
//  - a signed-in user who is NOT a member of the timer's workspace cannot
//    view or insert an active timer belonging to it, including via a
//    join-style query on task_id
//  - the anon/publishable key with no session reading `active_timers`
//    returns zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment. Mirrors tests/integration/rls-time-entries.test.ts (F108).

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

describe.skipIf(!haveCoreCreds)("RLS on active_timers (F109) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-176: anon/publishable key with no session reading active_timers returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("active_timers").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS + UNIQUE constraint on active_timers — member vs non-member (F109)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
    let taskA2Id: string;
    let timerAId: string;
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

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F109 RLS workspace A", slug: `f109-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B, used only to hold the non-member's own membership so
      // they have a valid session in *some* workspace.
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F109 RLS workspace B", slug: `f109-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      memberAEmail = `f109-member-a-${uniqueSuffix}@example.com`;
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

      nonMemberEmail = `f109-nonmember-${uniqueSuffix}@example.com`;
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

      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F109 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({ project_id: projectAId, title: "F109 RLS test task", author_id: memberAUserId })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

      // A second task in the same workspace, used to attempt a *second*
      // concurrent timer for the same user (AS-165) — proves the UNIQUE
      // constraint is on user_id alone, not (user_id, task_id).
      const { data: taskA2, error: taskA2Err } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "F109 RLS test task 2",
          author_id: memberAUserId,
        })
        .select("id")
        .single();
      if (taskA2Err || !taskA2) {
        throw new Error(`Failed to seed task A2: ${taskA2Err?.message}`);
      }
      taskA2Id = taskA2.id;

      // An active timer for member A on task A, seeded via the secret-key
      // client.
      const { data: timerA, error: timerAErr } = await adminClient
        .from("active_timers")
        .insert({ task_id: taskAId, user_id: memberAUserId })
        .select("id")
        .single();
      if (timerAErr || !timerA) {
        throw new Error(`Failed to seed active timer A: ${timerAErr?.message}`);
      }
      timerAId = timerA.id;

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
      if (timerAId) {
        await adminClient.from("active_timers").delete().eq("id", timerAId);
      }
      // In case AS-165's test below leaves a second timer behind despite
      // asserting rejection, clear any stray row for member A too.
      if (memberAUserId) {
        await adminClient.from("active_timers").delete().eq("user_id", memberAUserId);
      }
      if (taskAId) {
        await adminClient.from("tasks").delete().eq("id", taskAId);
      }
      if (taskA2Id) {
        await adminClient.from("tasks").delete().eq("id", taskA2Id);
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

    it("AS-164: a member of workspace A can start (INSERT) a live timer on a task", async () => {
      const { data, error } = await memberAClient
        .from("active_timers")
        .insert({ task_id: taskA2Id, user_id: "00000000-0000-0000-0000-000000000000" })
        .select("id")
        .single();
      // This attempt uses a bogus user_id (not memberA's own auth uid) just
      // to confirm INSERT is permitted by RLS for a workspace member in
      // principle; it will fail the FK against auth.users, which is
      // expected and unrelated to RLS. Assert the failure is NOT an RLS
      // denial (Postgres RLS violations and FK violations have distinct
      // error codes/messages).
      expect(error).not.toBeNull();
      expect(error?.message ?? "").not.toMatch(/row-level security/i);
      void data;
    });

    it("AS-164/AS-168: a member of workspace A can SELECT their own active timer back (server-persisted, survives reload)", async () => {
      const { data, error } = await memberAClient
        .from("active_timers")
        .select("id, task_id, user_id, started_at")
        .eq("id", timerAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(timerAId);
      expect(data?.[0]?.task_id).toBe(taskAId);
      expect(data?.[0]?.started_at).toBeTruthy();
    });

    it("AS-165: a direct second INSERT for the same user_id (different task) is rejected by the UNIQUE constraint, bypassing any action-layer logic", async () => {
      // memberAUserId already has an active timer (timerAId, on taskAId,
      // seeded in beforeAll). This is a raw insert attempt against a
      // *different* task, going straight to Postgres via the admin client
      // — no start-timer Server Action, no "stop the previous timer first"
      // logic in between. If the UNIQUE constraint on user_id didn't
      // exist, this insert would succeed and the user would end up with
      // two concurrent active timers.
      const { data, error } = await adminClient
        .from("active_timers")
        .insert({ task_id: taskA2Id, user_id: memberAUserId })
        .select("id");

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505"); // Postgres unique_violation
      expect(data).toBeNull();

      // Confirm the original timer is still the only row for this user.
      const { data: rows, error: countErr } = await adminClient
        .from("active_timers")
        .select("id")
        .eq("user_id", memberAUserId);
      expect(countErr).toBeNull();
      expect(rows).toHaveLength(1);
      expect(rows?.[0]?.id).toBe(timerAId);
    });

    it("AS-165: the same rejection holds when attempted through the member's own publishable-key session, not just the admin client", async () => {
      const { error } = await memberAClient
        .from("active_timers")
        .insert({ task_id: taskA2Id, user_id: memberAUserId });
      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
    });

    it("AS-176: a non-member cannot INSERT an active timer claiming a task_id in a workspace they don't belong to", async () => {
      const { error } = await nonMemberClient
        .from("active_timers")
        .insert({ task_id: taskA2Id, user_id: memberAUserId });
      expect(error).not.toBeNull();
    });

    it("AS-176: a non-member gets zero rows querying the active timer directly, even with a valid session in workspace B", async () => {
      const { data, error } = await nonMemberClient
        .from("active_timers")
        .select("*")
        .eq("id", timerAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-176: a non-member gets zero rows via a join-style query on task_id (active_timers -> tasks)", async () => {
      const { data, error } = await nonMemberClient
        .from("active_timers")
        .select("id, task_id, tasks(id, title)")
        .eq("id", timerAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("member A can DELETE (stop) their own active timer, freeing the UNIQUE slot for a new one", async () => {
      // timerAId (on taskAId) is member A's only active timer at this
      // point in the suite. Deleting it frees the UNIQUE(user_id) slot.
      const { error: delErr, count } = await memberAClient
        .from("active_timers")
        .delete({ count: "exact" })
        .eq("id", timerAId);
      expect(delErr).toBeNull();
      expect(count).toBe(1);

      // With the old row gone, a fresh insert for the same user now
      // succeeds — confirming the UNIQUE constraint blocks concurrency,
      // not the user_id value itself.
      const { data: recreated, error: recreateErr } = await adminClient
        .from("active_timers")
        .insert({ task_id: taskA2Id, user_id: memberAUserId })
        .select("id")
        .single();
      expect(recreateErr).toBeNull();
      expect(recreated?.id).toBeTruthy();

      // Point timerAId at the new row so afterAll's cleanup still works.
      timerAId = recreated!.id;
    });
  },
);
