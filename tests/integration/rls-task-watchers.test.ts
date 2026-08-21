// Integration test for F163 `task_watchers` schema + RLS (AS-293).
//
// Verifies against the real linked Supabase project that:
//  - a user can watch a task they are NOT assigned to, using only their own
//    signed-in session (not the admin client) — AS-293
//  - a user can unwatch (delete) their own watcher row, using their own
//    session
//  - a user cannot insert a watcher row on behalf of someone else (user_id
//    must equal auth.uid())
//  - a user who is not a member of the task's workspace cannot watch the
//    task at all — the insert is rejected
//  - a non-member gets zero rows querying task_watchers for that task,
//    even with a valid session in another workspace
//  - the anon/publishable key with no session reading task_watchers returns
//    zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment. Mirrors tests/integration/rls-checklist.test.ts (F151).

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
    "F163: missing Supabase credentials required to run this suite in CI (haveCoreCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F163: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveCoreCreds)("RLS on task_watchers (F163) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-293: anon/publishable key with no session reading task_watchers returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("task_watchers").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "task_watchers schema + RLS — self-serve watch/unwatch (F163)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let taskAId: string;
    let memberAUserId: string;
    let memberAEmail: string;
    let memberAPassword: string;
    let memberBUserId: string;
    let memberBEmail: string;
    let memberBPassword: string;
    let nonMemberEmail: string;
    let nonMemberPassword: string;
    let nonMemberUserId: string;
    let memberAClient: SupabaseClient;
    let memberBClient: SupabaseClient;
    let nonMemberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F163 RLS workspace A", slug: `f163-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      // Workspace B holds the non-member's own membership so they have a
      // valid session in *some* workspace (isolation must hold even then).
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F163 RLS workspace B", slug: `f163-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      memberAEmail = `f163-member-a-${uniqueSuffix}@example.com`;
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

      // Member B: a second, unassigned member of workspace A. Used to prove
      // AS-293 — watching a task you are not assigned to.
      memberBEmail = `f163-member-b-${uniqueSuffix}@example.com`;
      memberBPassword = "Test-password-1!";
      const { data: memberBAuth, error: memberBAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberBEmail,
          password: memberBPassword,
          email_confirm: true,
        });
      if (memberBAuthErr || !memberBAuth.user) {
        throw new Error(`Failed to create member-B test user: ${memberBAuthErr?.message}`);
      }
      memberBUserId = memberBAuth.user.id;

      const { error: memberAInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceAId, user_id: memberAUserId, role: "owner", status: "active" },
        { workspace_id: workspaceAId, user_id: memberBUserId, role: "member", status: "active" },
      ]);
      if (memberAInsertErr) {
        throw new Error(`Failed to seed workspace A memberships: ${memberAInsertErr.message}`);
      }

      nonMemberEmail = `f163-nonmember-${uniqueSuffix}@example.com`;
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
      nonMemberUserId = nonMemberAuth.user.id;

      const { error: nonMemberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: nonMemberUserId,
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
        .insert({ workspace_id: workspaceAId, name: "F163 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      // Task A is assigned to member A only — member B is deliberately not
      // the assignee, to prove AS-293 (watching a task you're not assigned
      // to).
      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectAId,
          title: "F163 RLS test task",
          author_id: memberAUserId,
          assignee_id: memberAUserId,
        })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to seed task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;

      memberAClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberASignInErr } = await memberAClient.auth.signInWithPassword({
        email: memberAEmail,
        password: memberAPassword,
      });
      if (memberASignInErr) {
        throw new Error(`Failed to sign in member-A test user: ${memberASignInErr.message}`);
      }

      memberBClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberBSignInErr } = await memberBClient.auth.signInWithPassword({
        email: memberBEmail,
        password: memberBPassword,
      });
      if (memberBSignInErr) {
        throw new Error(`Failed to sign in member-B test user: ${memberBSignInErr.message}`);
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
        await adminClient.from("task_watchers").delete().eq("task_id", taskAId);
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
      if (memberBUserId) {
        await adminClient.auth.admin.deleteUser(memberBUserId);
      }
      if (nonMemberUserId) {
        await adminClient.auth.admin.deleteUser(nonMemberUserId);
      }
    });

    it("AS-293: a user can watch a task they are not assigned to, using only their own session", async () => {
      // Member B is not the assignee of task A (member A is).
      const { data, error } = await memberBClient
        .from("task_watchers")
        .insert({ task_id: taskAId, user_id: memberBUserId })
        .select("task_id, user_id")
        .single();
      expect(error).toBeNull();
      expect(data?.task_id).toBe(taskAId);
      expect(data?.user_id).toBe(memberBUserId);

      // Re-read via the same session to prove it actually persisted.
      const { data: reread, error: rereadErr } = await memberBClient
        .from("task_watchers")
        .select("task_id, user_id")
        .eq("task_id", taskAId)
        .eq("user_id", memberBUserId);
      expect(rereadErr).toBeNull();
      expect(reread).toHaveLength(1);
    });

    it("a user can unwatch (delete) their own watcher row using their own session", async () => {
      const { error: deleteErr } = await memberBClient
        .from("task_watchers")
        .delete()
        .eq("task_id", taskAId)
        .eq("user_id", memberBUserId);
      expect(deleteErr).toBeNull();

      const { data: reread, error: rereadErr } = await memberBClient
        .from("task_watchers")
        .select("task_id, user_id")
        .eq("task_id", taskAId)
        .eq("user_id", memberBUserId);
      expect(rereadErr).toBeNull();
      expect(reread).toEqual([]);
    });

    it("a user cannot insert a watcher row on behalf of someone else", async () => {
      const { error } = await memberBClient
        .from("task_watchers")
        .insert({ task_id: taskAId, user_id: memberAUserId });
      expect(error).not.toBeNull();

      // Confirm no row was actually created for member A by member B.
      const { data: check } = await adminClient
        .from("task_watchers")
        .select("task_id, user_id")
        .eq("task_id", taskAId)
        .eq("user_id", memberAUserId);
      expect(check).toEqual([]);
    });

    it("a non-member of the task's workspace cannot watch the task", async () => {
      const { error } = await nonMemberClient
        .from("task_watchers")
        .insert({ task_id: taskAId, user_id: nonMemberUserId });
      expect(error).not.toBeNull();
    });

    it("a non-member gets zero rows querying task_watchers for that task, even with a valid session in workspace B", async () => {
      // Seed a watcher row via the admin client so there is something to
      // (fail to) see.
      const { error: seedErr } = await adminClient
        .from("task_watchers")
        .insert({ task_id: taskAId, user_id: memberAUserId });
      expect(seedErr).toBeNull();

      const { data, error } = await nonMemberClient
        .from("task_watchers")
        .select("*")
        .eq("task_id", taskAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);

      await adminClient
        .from("task_watchers")
        .delete()
        .eq("task_id", taskAId)
        .eq("user_id", memberAUserId);
    });

    it("watching the same task twice as the same user is rejected by the primary key", async () => {
      const { error: firstErr } = await memberBClient
        .from("task_watchers")
        .insert({ task_id: taskAId, user_id: memberBUserId });
      expect(firstErr).toBeNull();

      const { error: secondErr } = await memberBClient
        .from("task_watchers")
        .insert({ task_id: taskAId, user_id: memberBUserId });
      expect(secondErr).not.toBeNull();

      await adminClient
        .from("task_watchers")
        .delete()
        .eq("task_id", taskAId)
        .eq("user_id", memberBUserId);
    });
  },
);
