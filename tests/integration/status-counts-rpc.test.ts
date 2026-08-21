// Integration test for F072 (AS-126, AS-127, AS-128, AS-129), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/search-tasks.test.ts and the sibling
// F071 test (tests/integration/priority-counts-rpc.test.ts).
//
// Exercises the `get_status_counts` RPC
// (supabase/migrations/20260818070000_rpc_status_counts.sql) directly
// (not through an app data-layer wrapper — none exists yet; the dashboard
// UI itself is a later M7 feature), seeded with tasks across statuses, a
// soft-deleted task, a task in an archived project, and a task in a
// workspace the caller does not belong to, to prove:
//   AS-126/AS-127: the RPC returns per-status counts computed in the
//     database (a set-returning function, not a full row fetch), powering
//     the dashboard's status pie chart.
//   AS-128: soft-deleted tasks are excluded from the counts.
//   AS-129: tasks belonging to an archived (soft-deleted) project are
//     excluded from the counts by default.
//   RLS enforcement (SECURITY INVOKER): a caller who is not an active
//     member of the target workspace gets zero/empty rows back, not
//     another workspace's data and not an error — proving the RPC relies
//     on RLS rather than an app-level filter that could be bypassed.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "get_status_counts RPC (F072: AS-126, AS-127, AS-128, AS-129)",
  () => {
    let adminClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let archivedProjectId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f072-status-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create test user: ${memberAuthErr?.message}`,
        );
      }
      memberUserId = memberAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F072 Status Workspace",
          slug: `f072-status-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      // A second workspace the member does NOT belong to — the RLS-enforced
      // boundary case.
      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F072 Other Workspace",
          slug: `f072-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) {
        throw new Error(
          `Failed to create other workspace: ${otherWsErr?.message}`,
        );
      }
      otherWorkspaceId = otherWs.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "owner",
          status: "active",
        });
      if (memberErr) {
        throw new Error(`Failed to seed membership: ${memberErr.message}`);
      }

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F072 Active Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      // Archived project (soft-deleted via deleted_at) — its tasks must be
      // excluded from the counts by default (AS-129).
      const { data: archivedProject, error: archivedProjectErr } =
        await adminClient
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name: "F072 Archived Project",
            deleted_at: new Date().toISOString(),
          })
          .select("id")
          .single();
      if (archivedProjectErr || !archivedProject) {
        throw new Error(
          `Failed to seed archived project: ${archivedProjectErr?.message}`,
        );
      }
      archivedProjectId = archivedProject.id;

      const { data: otherProject, error: otherProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: otherWorkspaceId,
          name: "F072 Other Workspace Project",
        })
        .select("id")
        .single();
      if (otherProjectErr || !otherProject) {
        throw new Error(
          `Failed to seed other-workspace project: ${otherProjectErr?.message}`,
        );
      }

      // Seed tasks: 2 in_progress, 1 todo in the active, non-archived project.
      const activeInserts = [
        { status: "in_progress" },
        { status: "in_progress" },
        { status: "todo" },
      ];
      for (const [i, t] of activeInserts.entries()) {
        const { data, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: projectId,
            title: `F072 active task ${i}`,
            status: t.status,
            priority: "medium",
            author_id: memberUserId,
          })
          .select("id")
          .single();
        if (error || !data) {
          throw new Error(`Failed to seed active task: ${error?.message}`);
        }
        createdTaskIds.push(data.id);
      }

      // Soft-deleted task (status 'in_progress') — must NOT be counted (AS-128).
      const { data: deletedTask, error: deletedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F072 soft-deleted task",
          status: "in_progress",
          priority: "medium",
          author_id: memberUserId,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (deletedErr || !deletedTask) {
        throw new Error(
          `Failed to seed soft-deleted task: ${deletedErr?.message}`,
        );
      }
      createdTaskIds.push(deletedTask.id);

      // Task in the archived project (status 'done') — must NOT be
      // counted by default (AS-129).
      const { data: archivedProjectTask, error: archivedProjectTaskErr } =
        await adminClient
          .from("tasks")
          .insert({
            project_id: archivedProjectId,
            title: "F072 task in archived project",
            status: "done",
            priority: "medium",
            author_id: memberUserId,
          })
          .select("id")
          .single();
      if (archivedProjectTaskErr || !archivedProjectTask) {
        throw new Error(
          `Failed to seed archived-project task: ${archivedProjectTaskErr?.message}`,
        );
      }
      createdTaskIds.push(archivedProjectTask.id);

      // Task in the OTHER workspace (status 'in_progress') — must never be
      // counted when querying workspaceId (workspace scoping).
      const { data: leakTask, error: leakErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: otherProject.id,
          title: "F072 other workspace task",
          status: "in_progress",
          priority: "medium",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (leakErr || !leakTask) {
        throw new Error(`Failed to seed leak task: ${leakErr?.message}`);
      }
      createdTaskIds.push(leakTask.id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword(
        {
          email: memberEmail,
          password: memberPassword,
        },
      );
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      await adminClient.from("projects").delete().eq("workspace_id", workspaceId);
      await adminClient
        .from("projects")
        .delete()
        .eq("workspace_id", otherWorkspaceId);
      for (const id of [workspaceId, otherWorkspaceId]) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("AS-126, AS-127: a workspace member gets correct per-status counts computed in the database", async () => {
      const { data, error } = await memberClient.rpc("get_status_counts", {
        p_workspace_id: workspaceId,
      });

      expect(error).toBeNull();
      const rows = data ?? [];
      const byStatus = Object.fromEntries(
        rows.map((r: { status: string; count: number }) => [
          r.status,
          Number(r.count),
        ]),
      );

      expect(byStatus.in_progress).toBe(2);
      expect(byStatus.todo).toBe(1);
    });

    it("AS-128: counts exclude soft-deleted tasks", async () => {
      const { data, error } = await memberClient.rpc("get_status_counts", {
        p_workspace_id: workspaceId,
      });

      expect(error).toBeNull();
      const rows = data ?? [];
      const inProgressRow = rows.find(
        (r: { status: string }) => r.status === "in_progress",
      );
      // 2 active 'in_progress' tasks were seeded, plus 1 soft-deleted
      // 'in_progress' task. If the soft-deleted row leaked in, this would
      // be 3.
      expect(Number(inProgressRow?.count)).toBe(2);
    });

    it("AS-129: counts exclude tasks belonging to an archived (soft-deleted) project by default", async () => {
      const { data, error } = await memberClient.rpc("get_status_counts", {
        p_workspace_id: workspaceId,
      });

      expect(error).toBeNull();
      const rows = data ?? [];
      // The archived project's task has status 'done', which was never
      // seeded on any active project — its absence proves exclusion.
      const doneRow = rows.find(
        (r: { status: string }) => r.status === "done",
      );
      expect(doneRow).toBeUndefined();
    });

    it("RLS-enforced: a non-member calling this RPC for a workspace they don't belong to gets zero/empty results, not another workspace's data", async () => {
      const { data, error } = await memberClient.rpc("get_status_counts", {
        p_workspace_id: otherWorkspaceId,
      });

      // RLS filters silently (no error), matching the established
      // convention (search-tasks.test.ts, rls-tasks.test.ts) of "filtered,
      // not errored".
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);
    });
  },
);
