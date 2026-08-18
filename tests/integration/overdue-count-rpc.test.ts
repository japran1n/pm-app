// Integration test for F075 (AS-131), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/search-tasks.test.ts and the sibling F071/F072 tests
// (priority-counts-rpc.test.ts, status-counts-rpc.test.ts).
//
// Exercises the `get_overdue_count` RPC
// (supabase/migrations/20260818080000_rpc_overdue_count.sql) directly
// (no app data-layer wrapper needed beyond lib/queries/dashboard.ts's
// thin getOverdueCount, which just forwards the RPC call), seeded with:
//   - two overdue tasks (due_date in the past, status != 'done')
//   - a done task with a past due_date (must NOT count — AS-131's
//     "status not done" half, mirroring lib/tasks/is-overdue.ts's
//     AS-064 rule)
//   - a task due today (must NOT count — "in the past" is strict)
//   - a task due in the future (must NOT count)
//   - a soft-deleted overdue task (must NOT count)
//   - an overdue task in an archived project (must NOT count)
//   - an overdue task in a workspace the caller does not belong to
//     (must NOT count — RLS/workspace scoping)
// to prove AS-131: "The dashboard shows a count of overdue tasks (due
// date in the past, status not `done`)," computed in the database.

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

function isoDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!haveAdminCreds)(
  "get_overdue_count RPC (F075: AS-131)",
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

      const memberEmail = `f075-overdue-member-${uniqueSuffix}@example.com`;
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
          name: "F075 Overdue Workspace",
          slug: `f075-overdue-${uniqueSuffix}`,
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
          name: "F075 Other Workspace",
          slug: `f075-other-${uniqueSuffix}`,
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
        .insert({ workspace_id: workspaceId, name: "F075 Active Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      // Archived project (soft-deleted via deleted_at) — its overdue tasks
      // must be excluded from the count by default.
      const { data: archivedProject, error: archivedProjectErr } =
        await adminClient
          .from("projects")
          .insert({
            workspace_id: workspaceId,
            name: "F075 Archived Project",
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
          name: "F075 Other Workspace Project",
        })
        .select("id")
        .single();
      if (otherProjectErr || !otherProject) {
        throw new Error(
          `Failed to seed other-workspace project: ${otherProjectErr?.message}`,
        );
      }

      const pastDate = isoDateOffset(-5);
      const todayDate = isoDateOffset(0);
      const futureDate = isoDateOffset(5);

      const seedTask = async (attrs: {
        project_id: string;
        title: string;
        status: string;
        due_date: string | null;
        deleted_at?: string;
      }) => {
        const { data, error } = await adminClient
          .from("tasks")
          .insert({
            project_id: attrs.project_id,
            title: attrs.title,
            status: attrs.status,
            priority: "medium",
            author_id: memberUserId,
            due_date: attrs.due_date,
            deleted_at: attrs.deleted_at,
          })
          .select("id")
          .single();
        if (error || !data) {
          throw new Error(`Failed to seed task "${attrs.title}": ${error?.message}`);
        }
        createdTaskIds.push(data.id);
      };

      // Two genuinely overdue tasks — past due_date, status != 'done'.
      await seedTask({
        project_id: projectId,
        title: "F075 overdue task 1",
        status: "todo",
        due_date: pastDate,
      });
      await seedTask({
        project_id: projectId,
        title: "F075 overdue task 2",
        status: "in_progress",
        due_date: pastDate,
      });

      // Past due but status 'done' — must NOT count (AS-131's "status not
      // done" half, mirroring is-overdue.ts's AS-064 rule).
      await seedTask({
        project_id: projectId,
        title: "F075 done task with past due date",
        status: "done",
        due_date: pastDate,
      });

      // Due today — "in the past" is strict, today doesn't count.
      await seedTask({
        project_id: projectId,
        title: "F075 task due today",
        status: "todo",
        due_date: todayDate,
      });

      // Due in the future — must not count.
      await seedTask({
        project_id: projectId,
        title: "F075 task due in the future",
        status: "todo",
        due_date: futureDate,
      });

      // Soft-deleted overdue task — must not count.
      await seedTask({
        project_id: projectId,
        title: "F075 soft-deleted overdue task",
        status: "todo",
        due_date: pastDate,
        deleted_at: new Date().toISOString(),
      });

      // Overdue task in the archived project — must not count by default.
      await seedTask({
        project_id: archivedProjectId,
        title: "F075 overdue task in archived project",
        status: "todo",
        due_date: pastDate,
      });

      // Overdue task in the OTHER workspace — must never be counted when
      // querying workspaceId.
      await seedTask({
        project_id: otherProject.id,
        title: "F075 other workspace overdue task",
        status: "todo",
        due_date: pastDate,
      });

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

    it("AS-131: a workspace member gets the correct overdue count, excluding done-status and non-past-due tasks", async () => {
      const { data, error } = await memberClient.rpc("get_overdue_count", {
        p_workspace_id: workspaceId,
      });

      expect(error).toBeNull();
      // Only the two genuinely overdue tasks count: the done task, the
      // today/future-due tasks, the soft-deleted task, and the archived
      // -project task are all excluded.
      expect(Number(data)).toBe(2);
    });

    it("RLS-enforced: a non-member calling this RPC for a workspace they don't belong to gets 0, not another workspace's data", async () => {
      const { data, error } = await memberClient.rpc("get_overdue_count", {
        p_workspace_id: otherWorkspaceId,
      });

      // RLS filters silently (no error), matching the established
      // convention (search-tasks.test.ts, status-counts-rpc.test.ts) of
      // "filtered, not errored".
      expect(error).toBeNull();
      expect(Number(data)).toBe(0);
    });
  },
);
