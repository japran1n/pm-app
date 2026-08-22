// F195 follow-up fix (AS-360), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf/admin-client fixture pattern
// established by tests/integration/recurrence-scheduled-generation.test.ts
// (F178) and tests/integration/task-activity-writer.test.ts (F194).
//
// AS-360: "recurrence-job changes are attributed to the system." F195
// wired this for the TypeScript on-completion path
// (lib/recurrence/generate-next-occurrence.ts) but explicitly flagged
// that F178's pure-SQL, pg_cron-scheduled `generate_due_recurring_
// occurrences()` did NOT write a task_activity entry for occurrences it
// generates. This suite calls that SQL function directly via `.rpc(...)`
// against a seeded due recurring task and asserts a task_activity row
// now exists for the newly generated occurrence, with `actor_id` null
// (system-attributed, per the function's own `p_system := true` call).

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F195 follow-up: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// Fixed past due date so "next due date has arrived" is unambiguous
// regardless of the real wall-clock date at test-run time.
const FIXED_PAST_DUE_DATE = "2020-01-01";

describe.skipIf(!haveAdminCreds)(
  "generate_due_recurring_occurrences task_activity write (F195 follow-up: AS-360)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F195 Followup Test Workspace",
          slug: `f195-followup-recurrence-activity-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f195-followup-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create member user: ${memberAuthErr?.message}`,
        );
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
          name: `F195 Followup Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);
    });

    afterAll(async () => {
      // task_activity rows cascade-delete with their task (on delete
      // cascade), so deleting the tasks is sufficient cleanup for them.
      await adminClient
        .from("tasks")
        .delete()
        .in("recurrence_parent_id", createdTaskIds);
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient
          .from("workspace_members")
          .delete()
          .eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function makeRecurringTask(opts: {
      dueDate: string;
      recurrence?: unknown;
    }): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F195 Followup Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          status: "in_progress",
          due_date: opts.dueDate,
          recurrence: opts.recurrence ?? { freq: "daily", interval: 1 },
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed recurring task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-360: the scheduled SQL generator writes a system-attributed task_activity entry for the new occurrence", async () => {
      const taskId = await makeRecurringTask({
        dueDate: FIXED_PAST_DUE_DATE,
        recurrence: { freq: "daily", interval: 1 },
      });

      const { error: rpcError } = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(rpcError).toBeNull();

      const { data: occurrences, error: occErr } = await adminClient
        .from("tasks")
        .select("id, due_date")
        .eq("recurrence_parent_id", taskId);
      expect(occErr).toBeNull();
      expect(occurrences).toHaveLength(1);
      const newOccurrenceId = occurrences![0].id;

      const { data: activity, error: activityErr } = await adminClient
        .from("task_activity")
        .select("id, task_id, actor_id, kind, field, old_value, new_value")
        .eq("task_id", newOccurrenceId);

      expect(activityErr).toBeNull();
      expect(activity).toHaveLength(1);
      expect(activity![0].actor_id).toBeNull();
      expect(activity![0].kind).toBe("field_changed");
      expect(activity![0].field).toBe("due_date");
      expect(activity![0].old_value).toBeNull();
      expect(activity![0].new_value).toBe(occurrences![0].due_date);
    });

    it("AS-360 negative: the seeded (pre-existing) task itself gets no task_activity entry from the scheduled run — only the newly generated occurrence does", async () => {
      const taskId = await makeRecurringTask({
        dueDate: FIXED_PAST_DUE_DATE,
        recurrence: { freq: "daily", interval: 1 },
      });

      const { error: rpcError } = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(rpcError).toBeNull();

      const { data: activityOnSeed, error: activityErr } = await adminClient
        .from("task_activity")
        .select("id")
        .eq("task_id", taskId);

      expect(activityErr).toBeNull();
      expect(activityOnSeed ?? []).toHaveLength(0);
    });
  },
);
