// Integration tests for F177 (AS-315, AS-320, AS-321), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf/mock pattern
// established by tests/integration/move-task-status.test.ts, extended so
// `@/lib/supabase/server`'s mocked `createClient()` also exposes `.from`
// (needed by `getCurrentUserTimezone`, which moveTaskStatus now calls when
// generating a recurring task's next occurrence).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { seedLegacyStatusColumns } from "../helpers/legacy-status-columns";

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
    "F177: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;
let mockAdminForClient: SupabaseClient | null = null;

import { vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
    // `getCurrentUserTimezone` (lib/queries/profile.ts) reads
    // `profiles.timezone` off this same request-scoped client — the mock
    // proxies straight to the real admin client (service role bypasses
    // RLS, standing in for "this user's own session" in tests, same
    // approach every other integration test in this suite that needs a
    // real DB round trip through a mocked client already uses).
    from: (table: string) => mockAdminForClient!.from(table),
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "moveTaskStatus recurrence generation (F177: AS-315, AS-320, AS-321)",
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
      mockAdminForClient = adminClient;

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F177 Test Workspace",
          slug: `f177-recurrence-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f177-member-${uniqueSuffix}@example.com`;
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

      await adminClient
        .from("profiles")
        .update({ timezone: "UTC" })
        .eq("id", memberUserId);

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
          name: `F177 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // AS-321: a second project, archived (soft-deleted), for the
      // "archived project generates nothing" case.
      const { data: archivedProj, error: archivedProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F177 Archived Project ${uniqueSuffix}`,
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

      // status_set_v2 seeds every new project with the 11 v2-named
      // default columns; this suite's assertions use the legacy
      // todo/in_progress/in_review/done names as literal status values
      // (moveTaskStatus requires an exact project_statuses.name match —
      // see F221/AS-409), so seed the legacy four onto both projects.
      await seedLegacyStatusColumns(adminClient, projectId);
      await seedLegacyStatusColumns(adminClient, archivedProjectId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      // Any generated occurrence rows (recurrence_parent_id pointing at a
      // seeded task) are cleaned up too, since they aren't in
      // `createdTaskIds` (they're created by the action under test, not
      // the test's own setup).
      await adminClient
        .from("tasks")
        .delete()
        .in("recurrence_parent_id", createdTaskIds);
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
      status?: string;
      recurrence?: unknown;
    }): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: opts.projectId,
          title: `F177 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          status: opts.status ?? "in_progress",
          due_date: opts.dueDate,
          recurrence:
            opts.recurrence ?? { freq: "daily", interval: 1 },
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed recurring task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-315: completing a recurring task creates the next occurrence with the due date advanced", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");
      const taskId = await makeRecurringTask({
        projectId,
        dueDate: "2026-09-01",
        recurrence: { freq: "daily", interval: 1 },
      });

      currentTestUserId = memberUserId;
      const result = await moveTaskStatus(taskId, "done");
      expect(result.ok).toBe(true);

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id, due_date, status, recurrence_parent_id, recurrence")
        .eq("recurrence_parent_id", taskId);

      expect(occurrences).toHaveLength(1);
      expect(occurrences?.[0].due_date).toBe("2026-09-02");
      expect(occurrences?.[0].status).toBe("todo");
      expect(occurrences?.[0].recurrence).toEqual({
        freq: "daily",
        interval: 1,
      });
    });

    it("AS-320: completing the same recurring task twice does not create two occurrences", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");
      const taskId = await makeRecurringTask({
        projectId,
        dueDate: "2026-09-05",
        recurrence: { freq: "daily", interval: 1 },
      });

      currentTestUserId = memberUserId;

      const first = await moveTaskStatus(taskId, "done");
      expect(first.ok).toBe(true);

      // Simulate a double-submit / realtime replay: complete again while
      // already done.
      const second = await moveTaskStatus(taskId, "done");
      expect(second.ok).toBe(true);

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id, due_date")
        .eq("recurrence_parent_id", taskId);

      expect(occurrences).toHaveLength(1);
      expect(occurrences?.[0].due_date).toBe("2026-09-06");
    });

    it("AS-321: a recurring task in an archived project generates nothing, but completing it still succeeds", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");
      const taskId = await makeRecurringTask({
        projectId: archivedProjectId,
        dueDate: "2026-09-10",
        recurrence: { freq: "daily", interval: 1 },
      });

      currentTestUserId = memberUserId;
      const result = await moveTaskStatus(taskId, "done");

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.status).toBe("done");
      }

      const { data: statusRow } = await adminClient
        .from("tasks")
        .select("status")
        .eq("id", taskId)
        .single();
      expect(statusRow?.status).toBe("done");

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", taskId);
      expect(occurrences ?? []).toHaveLength(0);
    });

    it("AS-315 negative: a non-recurring task's completion generates no occurrence", async () => {
      const { moveTaskStatus } = await import("@/lib/actions/tasks");
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F177 Non-recurring ${Date.now()}`,
          author_id: memberUserId,
          status: "in_progress",
          due_date: "2026-09-15",
          recurrence: null,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error("seed failed");
      const taskId = data.id;
      createdTaskIds.push(taskId);

      currentTestUserId = memberUserId;
      const result = await moveTaskStatus(taskId, "done");
      expect(result.ok).toBe(true);

      const { data: occurrences } = await adminClient
        .from("tasks")
        .select("id")
        .eq("recurrence_parent_id", taskId);
      expect(occurrences ?? []).toHaveLength(0);
    });
  },
);
