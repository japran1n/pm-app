// Integration test for F111 (AS-164, AS-165, AS-166, AS-167, AS-168), run
// against the real linked Supabase project — mirrors the loadDotEnv/skipIf
// pattern established by tests/integration/log-time-entry.test.ts.
//
// Unlike logTimeEntry (which only needs a mocked `auth.getUser()`),
// startTimer/stopTimer call the `start_timer_atomic`/`stop_timer_atomic`
// RPCs (supabase/migrations/20260818153433_create_stop_and_start_timer_rpc.sql)
// through the request-scoped client. Those functions are SECURITY DEFINER
// and source the caller's id from `auth.uid()`, which only resolves from a
// real signed-in session's JWT — a mocked `getUser()` return value is not
// enough. So `@/lib/supabase/server`'s `createClient()` is mocked to
// return an actual `@supabase/supabase-js` client, signed in via
// `signInWithPassword` as a real throwaway test user for the current test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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

const MEMBER_PASSWORD = "Test-password-1!";

// Holds the currently "signed in" per-user client the mocked
// `@/lib/supabase/server` createClient() returns. Tests swap this before
// calling into the action under test.
let currentUserClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentUserClient,
}));

describe.skipIf(!haveAdminCreds)(
  "startTimer / stopTimer / getActiveTimer (F111: AS-164, AS-165, AS-166, AS-167, AS-168)",
  () => {
    let adminClient: SupabaseClient;
    const createdTimeEntryIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskAId: string;
    let taskBId: string;
    let memberUserId: string;
    let memberEmail: string;
    let memberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F111 Test Workspace",
          slug: `f111-timer-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f111-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: MEMBER_PASSWORD,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "member",
          status: "active",
        });
      if (memberInsertErr) {
        throw new Error(`Failed to seed member: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F111 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: taskA, error: taskAErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F111 Task A ${uniqueSuffix}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskAErr || !taskA) {
        throw new Error(`Failed to create test task A: ${taskAErr?.message}`);
      }
      taskAId = taskA.id;
      createdTaskIds.push(taskAId);

      const { data: taskB, error: taskBErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F111 Task B ${uniqueSuffix}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskBErr || !taskB) {
        throw new Error(`Failed to create test task B: ${taskBErr?.message}`);
      }
      taskBId = taskB.id;
      createdTaskIds.push(taskBId);

      // A real signed-in client for the member — RPCs need a genuine JWT
      // so auth.uid() resolves inside the SECURITY DEFINER functions.
      memberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: MEMBER_PASSWORD,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }
    });

    beforeEach(async () => {
      currentUserClient = memberClient;
      // Make sure no active timer leaks between tests.
      await adminClient.from("active_timers").delete().eq("user_id", memberUserId);
    });

    afterAll(async () => {
      await adminClient.from("active_timers").delete().eq("user_id", memberUserId);
      for (const entryId of createdTimeEntryIds) {
        await adminClient.from("time_entries").delete().eq("id", entryId);
      }
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

    it("AS-164: starting a timer with none active succeeds", async () => {
      const { startTimer } = await import("@/lib/actions/time-entries");

      const result = await startTimer(taskAId);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.taskId).toBe(taskAId);
      expect(result.data.userId).toBe(memberUserId);
      expect(result.data.startedAt).toBeTruthy();

      const { data: row } = await adminClient
        .from("active_timers")
        .select("id, task_id, user_id")
        .eq("user_id", memberUserId)
        .maybeSingle();
      expect(row?.task_id).toBe(taskAId);
    });

    it("AS-165/AS-166: starting a second timer auto-stops and logs the first", async () => {
      const { startTimer } = await import("@/lib/actions/time-entries");

      const first = await startTimer(taskAId);
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const firstActiveId = first.data.id;

      // Backdate started_at so the elapsed-minutes assertion below is
      // meaningful rather than always hitting the 1-minute floor.
      await adminClient
        .from("active_timers")
        .update({ started_at: new Date(Date.now() - 5 * 60_000).toISOString() })
        .eq("id", firstActiveId);

      const second = await startTimer(taskBId);
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.taskId).toBe(taskBId);

      // Old active_timers row is gone.
      const { data: oldRow } = await adminClient
        .from("active_timers")
        .select("id")
        .eq("id", firstActiveId)
        .maybeSingle();
      expect(oldRow).toBeNull();

      // New active_timers row exists for the new task.
      const { data: newRow } = await adminClient
        .from("active_timers")
        .select("id, task_id")
        .eq("user_id", memberUserId)
        .maybeSingle();
      expect(newRow?.task_id).toBe(taskBId);

      // A time_entries row was created for the OLD task with reasonable
      // minutes (around 5, allowing scheduling slack).
      const { data: entries } = await adminClient
        .from("time_entries")
        .select("id, task_id, minutes, billable")
        .eq("task_id", taskAId)
        .eq("user_id", memberUserId)
        .order("created_at", { ascending: false })
        .limit(1);

      expect(entries).toHaveLength(1);
      const entry = entries![0];
      createdTimeEntryIds.push(entry.id);
      expect(entry.minutes).toBeGreaterThanOrEqual(1);
      expect(entry.minutes).toBeLessThanOrEqual(15);
      expect(entry.billable).toBe(true);
    });

    it("AS-167: stopping a running timer creates a time entry with reasonable minutes and billable=true", async () => {
      const { startTimer, stopTimer } = await import(
        "@/lib/actions/time-entries"
      );

      const started = await startTimer(taskAId);
      expect(started.ok).toBe(true);
      if (!started.ok) return;

      await adminClient
        .from("active_timers")
        .update({ started_at: new Date(Date.now() - 2 * 60_000).toISOString() })
        .eq("id", started.data.id);

      const stopped = await stopTimer();
      expect(stopped.ok).toBe(true);
      if (!stopped.ok) return;

      createdTimeEntryIds.push(stopped.data.id);
      expect(stopped.data.taskId).toBe(taskAId);
      expect(stopped.data.userId).toBe(memberUserId);
      expect(stopped.data.billable).toBe(true);
      expect(stopped.data.minutes).toBeGreaterThanOrEqual(1);
      expect(stopped.data.minutes).toBeLessThanOrEqual(10);

      const { data: activeRow } = await adminClient
        .from("active_timers")
        .select("id")
        .eq("user_id", memberUserId)
        .maybeSingle();
      expect(activeRow).toBeNull();
    });

    it("AS-167: stopping with no active timer returns a clean error, not a crash", async () => {
      const { stopTimer } = await import("@/lib/actions/time-entries");

      const result = await stopTimer();

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();
    });

    it("AS-168: getActiveTimer returns null when no timer is active", async () => {
      const { getActiveTimer } = await import("@/lib/queries/time-entries");

      const result = await getActiveTimer();
      expect(result).toBeNull();
    });

    it("AS-168: getActiveTimer returns the running timer + task info once started", async () => {
      const { startTimer } = await import("@/lib/actions/time-entries");
      const { getActiveTimer } = await import("@/lib/queries/time-entries");

      const started = await startTimer(taskAId);
      expect(started.ok).toBe(true);

      const result = await getActiveTimer();
      expect(result).not.toBeNull();
      expect(result?.taskId).toBe(taskAId);
      expect(result?.task.id).toBe(taskAId);
      expect(result?.task.projectId).toBe(projectId);
      expect(result?.startedAt).toBeTruthy();
    });
  },
);
