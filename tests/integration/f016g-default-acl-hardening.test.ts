// Integration test for F016g (missions/20260903-portal, M3 remediation —
// blocker): closes the default-ACL hole that made every function in
// `public` reachable by `anon`/`authenticated` regardless of its own
// migration's `revoke ... from public`.
//
// Driven through real signed-in sessions and PostgREST/`.rpc()`, same
// convention as tests/integration/f013-deliverables-review-and-sweep.test.ts
// — no test here mocks the function it is asserting about. Two functions
// are exercised directly at the RPC boundary, bypassing the Server
// Action entirely, which is exactly the boundary this feature closes:
//
//   - purge_task: previously had no internal authorisation check at all.
//     Now rejects a direct call from an ordinary authenticated session
//     (a non-owner) and from anon.
//   - sweep_overdue_blocking_deliverables: a pg_cron-only job. Now
//     rejects a direct call from anon and from an authenticated session
//     entirely (it is not meant to be callable by any human session, not
//     even the workspace owner).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)(
  "F016g: default ACL hardening (purge_task / sweep_overdue_blocking_deliverables)",
  () => {
    let admin: SupabaseClient;
    let anonSession: SupabaseClient;
    let ownerSession: SupabaseClient;
    let memberSession: SupabaseClient;

    let workspaceId: string;
    let projectId: string;
    let ownerId: string;
    let memberId: string;
    let trashedTaskId: string;

    const createdUserIds: string[] = [];
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      anonSession = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const makeUser = async (label: string) => {
        const { data, error } = await admin.auth.admin.createUser({
          email: `f016g-acl-${label}-${suffix}@example.com`,
          password: PASSWORD,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email: data.user.email! };
      };

      const owner = await makeUser("owner");
      const memberUser = await makeUser("member");
      ownerId = owner.id;
      memberId = memberUser.id;

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F016g ACL test", slug: `f016g-acl-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      ]);

      const { data: project, error: projectError } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F016g project",
          visibility: "workspace",
          created_by: ownerId,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
      projectId = project.id;

      const { data: task, error: taskErr } = await admin
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F016g trashed task",
          author_id: ownerId,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (taskErr || !task) throw new Error(`task: ${taskErr?.message}`);
      trashedTaskId = task.id;
      createdTaskIds.push(trashedTaskId);

      const signIn = async (email: string) => {
        const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
        if (error) throw new Error(`sign-in ${email}: ${error.message}`);
        return session;
      };

      ownerSession = await signIn(owner.email);
      memberSession = await signIn(memberUser.email);
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await admin.from("tasks").delete().eq("id", taskId);
      }
      await admin.from("projects").delete().eq("id", projectId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const userId of createdUserIds) {
        await admin.auth.admin.deleteUser(userId);
      }
    });

    it("rejects purge_task called by anon (no session at all)", async () => {
      const { data, error } = await anonSession.rpc("purge_task", {
        p_task_id: trashedTaskId,
      });
      expect(data).toBeFalsy();
      expect(error).toBeTruthy();
    });

    it("rejects purge_task called directly by an authenticated non-owner (member)", async () => {
      // purge_task's Server Action always calls it via the admin
      // (service_role) client (lib/actions/purge.ts) — it is never
      // invoked with the caller's own session, so this migration grants
      // NO role execute privilege to `authenticated` at all (unlike
      // F006n's five RPCs, which ARE reachable directly by an
      // authenticated caller for some call paths). A direct call from
      // an ordinary member session is rejected at the Postgres ACL
      // level before the function body's own internal owner-only check
      // ever runs — still a hard rejection, just one layer earlier.
      const { data, error } = await memberSession.rpc("purge_task", {
        p_task_id: trashedTaskId,
      });
      expect(data).toBeFalsy();
      expect(error).toBeTruthy();
      expect(error?.message ?? "").toMatch(/permission denied/i);

      // Prove the task really is untouched — purge_task must not have
      // run any of its destructive statements.
      const { data: stillThere } = await admin
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", trashedTaskId)
        .maybeSingle();
      expect(stillThere?.deleted_at).toBeTruthy();
    });

    it("rejects purge_task called directly by the workspace owner too — no human session, not even an owner's, can call it outside the admin/service_role Server Action path", async () => {
      const { data, error } = await ownerSession.rpc("purge_task", {
        p_task_id: trashedTaskId,
      });
      expect(data).toBeFalsy();
      expect(error).toBeTruthy();
      expect(error?.message ?? "").toMatch(/permission denied/i);
    });

    it("rejects sweep_overdue_blocking_deliverables called by anon", async () => {
      const { data, error } = await anonSession.rpc(
        "sweep_overdue_blocking_deliverables",
      );
      expect(data).toBeFalsy();
      expect(error).toBeTruthy();
    });

    it("rejects sweep_overdue_blocking_deliverables called directly by an authenticated session, even the workspace owner", async () => {
      const { data, error } = await ownerSession.rpc(
        "sweep_overdue_blocking_deliverables",
      );
      expect(data).toBeFalsy();
      expect(error).toBeTruthy();
    });
  },
);
