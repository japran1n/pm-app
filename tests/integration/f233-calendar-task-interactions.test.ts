// Integration test for F233 calendar-task-interactions (AS-444, AS-446,
// AS-447) -- run against the real linked Supabase project, mirrors the
// loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f232-calendar-query.test.ts.
//
// AS-444 (clicking a task opens its detail view): the calendar's task
// chips (and the day-overflow popover) link to the SAME board `?taskId=`
// route board.tsx's own click-to-open effect already listens on, which
// calls the real `getTaskDetail` Server Action (lib/actions/tasks.ts) --
// this test drives that exact function against real seeded rows, proving
// the real path, not a mock of it.
//
// AS-446 (tasks without a due date are absent, and the absence is
// explained): proven against the real `getUndatedTaskCount` query
// (lib/queries/calendar.ts).
//
// AS-447 (day overflow) is proven separately as a component test
// (tests/unit/f233-calendar-day-overflow.test.tsx) -- it's pure UI
// behaviour with no DB dependency.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F233: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

// getTaskDetail (lib/actions/tasks.ts) also calls createAdminClient -- the
// real admin client construction needs real env creds, which are present
// in this integration run (haveAdminCreds gate above), so no mock is
// needed for it, matching f322/f323's own integration tests' approach of
// letting the real admin client run against the real project.

describe.skipIf(!haveAdminCreds)(
  "F233 calendar task interactions (AS-444, AS-446)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let visibleProjectId: string;
    let privateProjectId: string;

    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let memberUserId: string;
    let otherMemberUserId: string;

    let openableTaskId: string;
    let privateTaskId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F233 Workspace", slug: `f233-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f233-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { data: otherAuth, error: otherAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f233-other-${uniqueSuffix}@example.com`,
          password: memberPassword,
          email_confirm: true,
        });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other member: ${otherAuthErr?.message}`);
      }
      otherMemberUserId = otherAuth.user.id;
      createdUserIds.push(otherMemberUserId);

      const { error: memberRowErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
      ]);
      if (memberRowErr) throw new Error(`Failed to seed membership: ${memberRowErr.message}`);

      const { data: visibleProject, error: visibleErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F233 Visible Project", visibility: "workspace" })
        .select("id")
        .single();
      if (visibleErr || !visibleProject) {
        throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
      }
      visibleProjectId = visibleProject.id;
      createdProjectIds.push(visibleProjectId);

      const { data: privateProject, error: privateErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F233 Private Project", visibility: "private" })
        .select("id")
        .single();
      if (privateErr || !privateProject) {
        throw new Error(`Failed to seed private project: ${privateErr?.message}`);
      }
      privateProjectId = privateProject.id;
      createdProjectIds.push(privateProjectId);
      await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: otherMemberUserId,
      });

      // A normal openable task in a project the calendar member CAN see.
      const { data: openTask, error: openTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F233 openable task",
          status: "todo",
          priority: "high",
          author_id: memberUserId,
          due_date: "2026-06-10",
          number: 1,
        })
        .select("id")
        .single();
      if (openTaskErr || !openTask) {
        throw new Error(`Failed to seed openable task: ${openTaskErr?.message}`);
      }
      openableTaskId = openTask.id;

      // A due-dated task in the PRIVATE project the calendar member cannot
      // see -- the real target of AS-444's negative case: the calendar
      // never links to it (getCalendarTasks already excludes it, proven by
      // F232), and even if a caller had the raw id (e.g. a stale/shared
      // URL), opening it must fail with the SAME "Task not found." message
      // as a genuinely nonexistent task -- never a distinguishable
      // "forbidden" (F323's convention).
      const { data: privateTask, error: privateTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F233 private task",
          status: "todo",
          priority: "urgent",
          author_id: otherMemberUserId,
          due_date: "2026-06-11",
          number: 1,
        })
        .select("id")
        .single();
      if (privateTaskErr || !privateTask) {
        throw new Error(`Failed to seed private task: ${privateTaskErr?.message}`);
      }
      privateTaskId = privateTask.id;

      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInError } = await client.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInError) {
        throw new Error(`Failed to sign in member: ${signInError.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    });

    afterAll(async () => {
      for (const id of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", id);
        await adminClient.from("project_statuses").delete().eq("project_id", id);
        await adminClient.from("project_members").delete().eq("project_id", id);
        await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id);
      }
    });

    it("test_AS_444_clicking_a_task_the_caller_can_see_opens_its_real_detail_via_getTaskDetail", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(openableTaskId);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.task.id).toBe(openableTaskId);
        expect(result.data.task.title).toBe("F233 openable task");
      }
    });

    it("test_AS_444_negative_a_task_in_a_private_project_the_caller_cannot_see_is_not_reachable_and_the_refusal_does_not_confirm_it_exists", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail(privateTaskId);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        // F323's convention: the SAME message a genuinely nonexistent
        // task id gets -- never a distinguishable "forbidden"/"private"
        // message that would itself leak the task's existence.
        expect(result.error).toBe("Task not found.");
      }
    });

    it("test_AS_444_negative_a_nonexistent_task_id_gets_the_identical_not_found_message", async () => {
      const { getTaskDetail } = await import("@/lib/actions/tasks");
      const result = await getTaskDetail("00000000-0000-0000-0000-000000000000");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("Task not found.");
      }
    });

    it("test_AS_446_undated_task_count_excludes_dated_tasks_and_counts_only_visible_undated_ones", async () => {
      const { getUndatedTaskCount } = await import("@/lib/queries/calendar");
      const before = await getUndatedTaskCount(workspaceId);

      const { data: undatedTask, error: undatedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F233 undated task",
          status: "todo",
          priority: "medium",
          author_id: memberUserId,
          number: 2,
        })
        .select("id")
        .single();
      if (undatedErr || !undatedTask) {
        throw new Error(`Failed to seed undated task: ${undatedErr?.message}`);
      }

      const after = await getUndatedTaskCount(workspaceId);
      expect(after).toBe(before + 1);

      await adminClient.from("tasks").delete().eq("id", undatedTask.id);
    });

    it("test_AS_446_negative_an_undated_task_in_a_private_project_the_caller_cannot_see_is_not_counted", async () => {
      const { getUndatedTaskCount } = await import("@/lib/queries/calendar");
      const before = await getUndatedTaskCount(workspaceId);

      const { data: privateUndated, error: privateUndatedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F233 private undated task",
          status: "todo",
          priority: "medium",
          author_id: otherMemberUserId,
          number: 2,
        })
        .select("id")
        .single();
      if (privateUndatedErr || !privateUndated) {
        throw new Error(`Failed to seed private undated task: ${privateUndatedErr?.message}`);
      }

      const after = await getUndatedTaskCount(workspaceId);
      expect(after).toBe(before);

      await adminClient.from("tasks").delete().eq("id", privateUndated.id);
    });
  },
);
