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
//
// F124 (AS-207) extends this file: `get_overdue_count` gained a
// `p_timezone` parameter (supabase/migrations/
// 20260818210500_rpc_overdue_count_timezone.sql) so "today" is computed
// against the CALLER's timezone at the SQL layer, not the database
// server's own clock — the dashboard overdue tile must never disagree
// with lib/tasks/is-overdue.ts's client-side definition. The AS-207 tests
// below seed one extra task due on "today, as seen from Etc/GMT+12"
// (computed at test run time, not hard-coded, so this is never flaky
// regardless of what wall-clock time the suite happens to run at) and
// prove the SAME row is NOT overdue when queried with an earlier zone but
// IS overdue when queried with a zone far enough east that its own
// "today" has already advanced past that date — Etc/GMT+12 (UTC-12) and
// Pacific/Kiritimati (UTC+14) are a 26-hour spread, which is more than a
// full 24-hour calendar day, so their two "today"s can never be equal at
// any real-world instant (verified by brute-force over a full UTC day
// before writing this fixture — see this feature's handoff).

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

// F124 (AS-207): "YYYY-MM-DD" for right now, as seen from `timeZone`.
// Deliberately a standalone computation (not an import of
// lib/time/user-timezone.ts's own `todayInTimeZone`) so this integration
// test is an independent check that the SQL RPC and the app's date module
// agree, not a test that re-derives its expectation from the same code
// it's meant to be verifying.
function todayInZone(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
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

// F124 (AS-207): isolated fixture, deliberately separate from the
// describe block above — a task due exactly "today in Etc/GMT+12" would
// make the AS-131 baseline test's expected count depend on what wall-clock
// time the suite happens to run at (whenever it's currently before noon
// UTC, Etc/GMT+12 is a calendar day behind UTC, which would tip that
// fixture into "overdue" for a plain UTC-default RPC call too). A
// standalone workspace/project/task avoids coupling this feature's
// timezone-boundary fixture to F075's own count.
describe.skipIf(!haveAdminCreds)(
  "get_overdue_count RPC timezone parameter (F124: AS-207)",
  () => {
    let adminClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let workspaceId: string;
    let taskId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const memberEmail = `f124-overdue-tz-member-${uniqueSuffix}@example.com`;
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
          name: "F124 Overdue TZ Workspace",
          slug: `f124-overdue-tz-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

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
        .insert({ workspace_id: workspaceId, name: "F124 Overdue TZ Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }

      // Due exactly on "today, as seen from Etc/GMT+12" — not overdue
      // when the RPC is queried with that same zone (due date == today
      // there), but overdue when queried with Pacific/Kiritimati, whose
      // own "today" has already advanced past that date at ANY
      // real-world instant (Etc/GMT+12 = UTC-12, Pacific/Kiritimati =
      // UTC+14; a 26-hour spread — more than one 24-hour calendar day —
      // so their two "today"s can never be equal; verified by brute-force
      // over a full UTC day before writing this fixture, see this
      // feature's handoff).
      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: project.id,
          title: "F124 zone-boundary task",
          status: "todo",
          priority: "medium",
          author_id: memberUserId,
          due_date: todayInZone("Etc/GMT+12"),
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to seed task: ${taskErr?.message}`);
      }
      taskId = task.id;

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
      if (taskId) await adminClient.from("tasks").delete().eq("id", taskId);
      await adminClient.from("projects").delete().eq("workspace_id", workspaceId);
      await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("test_AS_207_get_overdue_count_rpc_not_overdue_in_the_earlier_zone_where_due_date_is_still_today", async () => {
      const { data, error } = await memberClient.rpc("get_overdue_count", {
        p_workspace_id: workspaceId,
        p_timezone: "Etc/GMT+12",
      });

      expect(error).toBeNull();
      expect(Number(data)).toBe(0);
    });

    it("test_AS_207_get_overdue_count_rpc_marks_it_overdue_in_the_later_zone_where_local_today_has_advanced_past_it", async () => {
      const { data, error } = await memberClient.rpc("get_overdue_count", {
        p_workspace_id: workspaceId,
        p_timezone: "Pacific/Kiritimati",
      });

      expect(error).toBeNull();
      expect(Number(data)).toBe(1);
    });

    it("test_AS_207_get_overdue_count_rpc_defaults_to_utc_when_p_timezone_is_omitted", async () => {
      // No p_timezone argument at all — proves the SQL-side default
      // ('UTC') is reachable through PostgREST's RPC call, not just
      // present in the function signature, so every pre-F124 caller
      // (including this file's own AS-131 tests above) keeps working
      // unchanged.
      const withDefault = await memberClient.rpc("get_overdue_count", {
        p_workspace_id: workspaceId,
      });
      const withExplicitUtc = await memberClient.rpc("get_overdue_count", {
        p_workspace_id: workspaceId,
        p_timezone: "UTC",
      });

      expect(withDefault.error).toBeNull();
      expect(withExplicitUtc.error).toBeNull();
      expect(Number(withDefault.data)).toBe(Number(withExplicitUtc.data));
    });
  },
);
