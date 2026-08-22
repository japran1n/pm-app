// Integration test for F114's `get_project_time_totals` RPC (AS-172, AS-174),
// extended by F168 (AS-303, AS-304) to also cover the RPC's `estimate_minutes`
// column.
//
// Verifies against the real linked Supabase project that:
//  - billable and non-billable minutes are summed and split correctly
//    across several time entries logged on a project's tasks
//  - a soft-deleted task's logged time is excluded from the total: the
//    RPC's reported total drops by exactly that task's minutes once the
//    task is soft-deleted (AS-174)
//  - the project's task estimates are summed against the logged time
//    (AS-303)
//  - a soft-deleted task's estimate is excluded from the estimate sum,
//    exactly mirroring AS-174's logged-time behaviour (AS-304)
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment. Mirrors tests/integration/rls-time-entries.test.ts (F108)
// for setup/teardown shape.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "get_project_time_totals RPC (F114)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let projectId: string;
    let taskKeptId: string;
    let taskDeletedId: string;
    let userId: string;
    const entryIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F114 totals workspace", slug: `f114-totals-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      const email = `f114-totals-${uniqueSuffix}@example.com`;
      const { data: userAuth, error: userAuthErr } =
        await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (userAuthErr || !userAuth.user) {
        throw new Error(`Failed to create test user: ${userAuthErr?.message}`);
      }
      userId = userAuth.user.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role: "owner",
        status: "active",
      });
      if (memberErr) {
        throw new Error(`Failed to seed membership: ${memberErr.message}`);
      }

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F114 totals project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      const { data: taskKept, error: taskKeptErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F114 kept task",
          author_id: userId,
          estimate_minutes: 120,
        })
        .select("id")
        .single();
      if (taskKeptErr || !taskKept) {
        throw new Error(`Failed to seed kept task: ${taskKeptErr?.message}`);
      }
      taskKeptId = taskKept.id;

      const { data: taskDeleted, error: taskDeletedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F114 soft-deleted task",
          author_id: userId,
          estimate_minutes: 200,
        })
        .select("id")
        .single();
      if (taskDeletedErr || !taskDeleted) {
        throw new Error(`Failed to seed to-be-deleted task: ${taskDeletedErr?.message}`);
      }
      taskDeletedId = taskDeleted.id;

      // Kept task: 40 billable + 25 non-billable minutes.
      // Soft-deleted task: 100 billable minutes that must NOT count once
      // the task is soft-deleted.
      const entries = [
        { task_id: taskKeptId, user_id: userId, minutes: 40, billable: true },
        { task_id: taskKeptId, user_id: userId, minutes: 25, billable: false },
        { task_id: taskDeletedId, user_id: userId, minutes: 100, billable: true },
      ];
      const { data: insertedEntries, error: entriesErr } = await adminClient
        .from("time_entries")
        .insert(entries)
        .select("id");
      if (entriesErr || !insertedEntries) {
        throw new Error(`Failed to seed time entries: ${entriesErr?.message}`);
      }
      entryIds.push(...insertedEntries.map((e) => e.id));
    });

    afterAll(async () => {
      for (const id of entryIds) {
        await adminClient.from("time_entries").delete().eq("id", id);
      }
      if (taskKeptId) {
        await adminClient.from("tasks").delete().eq("id", taskKeptId);
      }
      if (taskDeletedId) {
        await adminClient.from("tasks").delete().eq("id", taskDeletedId);
      }
      if (projectId) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (userId) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-172: sums billable and non-billable minutes correctly across all of the project's tasks before any soft-deletion", async () => {
      const { data, error } = await adminClient.rpc("get_project_time_totals", {
        p_project_id: projectId,
      });
      expect(error).toBeNull();
      const row = data?.[0];
      // 40 (kept, billable) + 100 (deleted task, billable) = 140.
      expect(Number(row?.billable_minutes)).toBe(140);
      // 25 (kept, non-billable).
      expect(Number(row?.non_billable_minutes)).toBe(25);
    });

    it("AS-303: sums the project's task estimates alongside the logged time totals", async () => {
      const { data, error } = await adminClient.rpc("get_project_time_totals", {
        p_project_id: projectId,
      });
      expect(error).toBeNull();
      const row = data?.[0];
      // 120 (kept task's estimate) + 200 (not-yet-deleted task's estimate) = 320.
      expect(Number(row?.estimate_minutes)).toBe(320);
    });

    it("AS-174 / AS-304: soft-deleting a task drops its logged time AND its estimate from the project totals", async () => {
      const { error: deleteErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", taskDeletedId);
      expect(deleteErr).toBeNull();

      const { data, error } = await adminClient.rpc("get_project_time_totals", {
        p_project_id: projectId,
      });
      expect(error).toBeNull();
      const row = data?.[0];
      // Only the kept task's 40 billable minutes remain; the deleted
      // task's 100 billable minutes must no longer be counted.
      expect(Number(row?.billable_minutes)).toBe(40);
      expect(Number(row?.non_billable_minutes)).toBe(25);
      // AS-304: only the kept task's 120-minute estimate remains; the
      // soft-deleted task's 200-minute estimate must no longer be summed.
      expect(Number(row?.estimate_minutes)).toBe(120);
    });
  },
);
