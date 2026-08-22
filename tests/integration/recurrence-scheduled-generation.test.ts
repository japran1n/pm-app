// Integration test for F178 (AS-322), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf/admin-client pattern
// established by tests/integration/recurrence-on-complete.test.ts.
//
// AS-322: "A scheduled job generates due occurrences for date-based
// recurrences without anyone opening the app." Per this feature's own
// spec: "test the underlying SQL function directly (via the admin
// client) against a seeded recurring task whose next occurrence is due,
// confirming a new task row is created — proving the mechanism works
// without waiting for the literal cron schedule to fire in a test
// environment." This suite calls `public.generate_due_recurring_occurrences()`
// directly via `.rpc(...)` — no app code, no `moveTaskStatus`, nothing
// that requires a human to have opened the app.

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
    "F178: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// A "today" fixed well in the past relative to any recurrence `due_date`
// this suite seeds, so "next due date has arrived" is unambiguously true
// without depending on the real wall-clock date at test-run time. Seeded
// due dates are chosen relative to `FIXED_PAST_DUE_DATE` instead.
const FIXED_PAST_DUE_DATE = "2020-01-01";

describe.skipIf(!haveAdminCreds)(
  "generate_due_recurring_occurrences (F178: AS-322)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let archivedProjectId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F178 Test Workspace",
          slug: `f178-recurrence-cron-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f178-member-${uniqueSuffix}@example.com`;
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
          name: `F178 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: archivedProj, error: archivedProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F178 Archived Project ${uniqueSuffix}`,
          created_by: memberUserId,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (archivedProjErr || !archivedProj) {
        throw new Error(
          `Failed to create archived test project: ${archivedProjErr?.message}`,
        );
      }
      archivedProjectId = archivedProj.id;
      createdProjectIds.push(archivedProjectId);
    });

    afterAll(async () => {
      // Generated occurrences point their recurrence_parent_id at a seeded
      // task, so clean those up first, then the seeded tasks themselves.
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
      projectId: string;
      dueDate: string | null;
      recurrence?: unknown;
    }): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: opts.projectId,
          title: `F178 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
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

    it("AS-322: a due recurring task gets a new occurrence generated by the SQL function directly", async () => {
      const taskId = await makeRecurringTask({
        projectId,
        dueDate: FIXED_PAST_DUE_DATE, // due long ago -> definitely "arrived"
        recurrence: { freq: "daily", interval: 1 },
      });

      const { error: rpcError } = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(rpcError).toBeNull();

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id, due_date, status, recurrence_parent_id, recurrence")
        .eq("recurrence_parent_id", taskId);

      expect(occurrences).toHaveLength(1);
      expect(occurrences?.[0].due_date).toBe("2020-01-02");
      expect(occurrences?.[0].status).toBe("todo");
      expect(occurrences?.[0].recurrence).toEqual({
        freq: "daily",
        interval: 1,
      });
    });

    it("AS-322: calling the function twice for the same due task does not create two occurrences", async () => {
      // interval is deliberately huge (20000 days) so the ONE occurrence
      // this run generates lands far in the future itself and is not
      // overdue on the second call — isolating "does the job re-generate
      // the exact same (root, due_date) pair" from the separate, correct
      // "each run also advances any newly-overdue occurrence" cascading
      // behaviour (every occurrence, generated or seeded, is an equally
      // valid candidate on the next run if IT is also overdue).
      const taskId = await makeRecurringTask({
        projectId,
        dueDate: FIXED_PAST_DUE_DATE,
        recurrence: { freq: "every_n_days", interval: 20000 },
      });

      const first = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(first.error).toBeNull();
      const second = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(second.error).toBeNull();

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id, due_date")
        .eq("recurrence_parent_id", taskId);

      expect(occurrences).toHaveLength(1);
    });

    it("AS-322: a run that generates an occurrence whose OWN next date is also already due cascades one step per run (documented, correct behaviour — not a duplicate)", async () => {
      const taskId = await makeRecurringTask({
        projectId,
        dueDate: FIXED_PAST_DUE_DATE,
        recurrence: { freq: "weekly", interval: 1 },
      });

      await adminClient.rpc("generate_due_recurring_occurrences");
      await adminClient.rpc("generate_due_recurring_occurrences");

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id, due_date")
        .eq("recurrence_parent_id", taskId)
        .order("due_date", { ascending: true });

      // Two runs, each overdue occurrence still in the past after the
      // first advance -> two distinct occurrences, never a duplicate
      // due_date pair (which the unique constraint would reject anyway).
      expect(occurrences).toHaveLength(2);
      expect(occurrences?.[0].due_date).toBe("2020-01-08");
      expect(occurrences?.[1].due_date).toBe("2020-01-15");
      const dueDates = (occurrences ?? []).map((o) => o.due_date);
      expect(new Set(dueDates).size).toBe(dueDates.length);
    });

    it("AS-322 negative: a recurring task whose next date has not arrived generates nothing", async () => {
      const farFutureDueDate = "2099-01-01";
      const taskId = await makeRecurringTask({
        projectId,
        dueDate: farFutureDueDate,
        recurrence: { freq: "daily", interval: 1 },
      });

      const { error } = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(error).toBeNull();

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", taskId);
      expect(occurrences ?? []).toHaveLength(0);
    });

    it("AS-322 negative: a non-recurring task generates nothing", async () => {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F178 Non-recurring ${Date.now()}`,
          author_id: memberUserId,
          status: "in_progress",
          due_date: FIXED_PAST_DUE_DATE,
          recurrence: null,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("seed failed");
      const taskId = data.id;
      createdTaskIds.push(taskId);

      const { error: rpcError } = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(rpcError).toBeNull();

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", taskId);
      expect(occurrences ?? []).toHaveLength(0);
    });

    it("AS-322 negative: a recurring task in an archived project generates nothing", async () => {
      const taskId = await makeRecurringTask({
        projectId: archivedProjectId,
        dueDate: FIXED_PAST_DUE_DATE,
        recurrence: { freq: "daily", interval: 1 },
      });

      const { error } = await adminClient.rpc(
        "generate_due_recurring_occurrences",
      );
      expect(error).toBeNull();

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", taskId);
      expect(occurrences ?? []).toHaveLength(0);
    });
  },
);
