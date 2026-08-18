// Integration test for F117 (AS-175, AS-176 hardening), run against the
// real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/log-time-entry.test.ts and
// tests/integration/start-stop-timer.test.ts.
//
// M9-scrutiny.md flagged that start_timer_atomic/stop_timer_atomic
// (SECURITY DEFINER) relied entirely on the calling Server Action's
// requireActiveMembership pre-check, not on anything inside the RPC body
// itself. This test proves the fix (20260818181000_harden_timer_rpc_membership.sql)
// by calling `supabase.rpc(...)` DIRECTLY — bypassing
// lib/actions/time-entries.ts entirely — as a real signed-in user who is
// NOT a member of the workspace that owns the target task, and asserting
// the RPC call itself is rejected.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

const OUTSIDER_PASSWORD = "Test-password-1!";

describe.skipIf(!haveAdminCreds)(
  "start_timer_atomic / stop_timer_atomic direct RPC membership hardening (F117: AS-175, AS-176)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let outsiderUserId: string;
    let outsiderEmail: string;
    let outsiderClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Workspace + task owned by a member who is NOT the outsider — the
      // outsider is never added to workspace_members for this workspace.
      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F117 Test Workspace",
          slug: `f117-timer-hardening-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      // Owning member (used only to satisfy created_by/author_id FKs).
      const ownerEmail = `f117-owner-${uniqueSuffix}@example.com`;
      const { data: ownerAuth, error: ownerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: ownerEmail,
          password: OUTSIDER_PASSWORD,
          email_confirm: true,
        });
      if (ownerAuthErr || !ownerAuth.user) {
        throw new Error(`Failed to create owner user: ${ownerAuthErr?.message}`);
      }
      createdUserIds.push(ownerAuth.user.id);

      const { error: ownerMemberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: ownerAuth.user.id,
          role: "owner",
          status: "active",
        });
      if (ownerMemberErr) {
        throw new Error(`Failed to seed owner member: ${ownerMemberErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F117 Project ${uniqueSuffix}`,
          created_by: ownerAuth.user.id,
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
          title: `F117 Task ${uniqueSuffix}`,
          author_id: ownerAuth.user.id,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;
      createdTaskIds.push(taskId);

      // The outsider: a real, authenticated user with NO membership row
      // in this workspace at all (not even a 'pending'/'removed' one).
      outsiderEmail = `f117-outsider-${uniqueSuffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: OUTSIDER_PASSWORD,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(
          `Failed to create outsider user: ${outsiderAuthErr?.message}`,
        );
      }
      outsiderUserId = outsiderAuth.user.id;
      createdUserIds.push(outsiderUserId);

      // A real signed-in client for the outsider — RPCs need a genuine JWT
      // so auth.uid() resolves inside the SECURITY DEFINER functions. This
      // client calls supabase.rpc(...) directly, never going through
      // lib/actions/time-entries.ts.
      outsiderClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await outsiderClient.auth.signInWithPassword(
        {
          email: outsiderEmail,
          password: OUTSIDER_PASSWORD,
        },
      );
      if (signInErr) {
        throw new Error(`Failed to sign in outsider: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      await adminClient.from("active_timers").delete().eq("user_id", outsiderUserId);
      await adminClient.from("time_entries").delete().eq("task_id", taskId);
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

    it("AS-175/AS-176: start_timer_atomic called directly by a non-member is rejected, no row written", async () => {
      const { error } = await outsiderClient.rpc("start_timer_atomic", {
        p_task_id: taskId,
      });

      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/not an active member/i);

      // Confirm no active_timers row was written as a side effect.
      const { data: row } = await adminClient
        .from("active_timers")
        .select("id")
        .eq("user_id", outsiderUserId)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("AS-175/AS-176: stop_timer_atomic called directly by a non-member on their own (foreign-task) active timer is rejected", async () => {
      // Seed an active_timers row directly (bypassing start_timer_atomic,
      // which would itself reject this) so stop_timer_atomic's own check
      // is exercised in isolation, proving it does not rely solely on
      // start_timer_atomic ever having run.
      const { data: seeded, error: seedErr } = await adminClient
        .from("active_timers")
        .insert({ task_id: taskId, user_id: outsiderUserId })
        .select("id")
        .single();
      expect(seedErr).toBeNull();

      const { error } = await outsiderClient.rpc("stop_timer_atomic");

      expect(error).toBeTruthy();
      expect(error?.message).toMatch(/not an active member/i);

      // The active_timers row must still exist — the RPC must reject
      // before performing its delete/insert side effects.
      const { data: row } = await adminClient
        .from("active_timers")
        .select("id")
        .eq("id", seeded!.id)
        .maybeSingle();
      expect(row).not.toBeNull();

      await adminClient.from("active_timers").delete().eq("id", seeded!.id);
    });
  },
);
