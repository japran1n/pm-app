// Integration test for F248 (AS-479): a quick-add must create the task in
// the REAL column it was typed in — a project's actual `project_statuses`
// row, never a hardcoded fixed-four status. Reuses the real `createTask`
// Server Action (the same one QuickAdd calls) against a real linked
// Supabase project, mirroring the loadDotEnv/skipIf pattern established by
// tests/integration/create-task.test.ts — this file additionally seeds a
// CUSTOM column (a name outside the original fixed four) and proves
// createTask targets it correctly, plus the negative case: a column name
// that doesn't exist in this project is rejected server-side rather than
// silently inserted with a dangling `status`/null `status_id`.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F248: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "F248 quick-add creates into the real project column (AS-479)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let memberUserId: string;
    let viewerUserId: string;
    const customColumnName = "In Design";

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F248 Test Workspace",
          slug: `f248-quick-add-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f248-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const viewerEmail = `f248-viewer-${uniqueSuffix}@example.com`;
      const { data: viewerAuth, error: viewerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: viewerEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (viewerAuthErr || !viewerAuth.user) {
        throw new Error(`Failed to create viewer user: ${viewerAuthErr?.message}`);
      }
      viewerUserId = viewerAuth.user.id;
      createdUserIds.push(viewerUserId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: memberUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: viewerUserId,
            role: "viewer",
            status: "active",
          },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F248 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // A genuinely custom column, outside the fixed four — the DB
      // trigger seeds todo/in_progress/in_review/done automatically on
      // project creation; this adds one more so the test proves createTask
      // resolves against ANY real project_statuses row, not just the
      // original four literal values.
      const { error: columnErr } = await adminClient
        .from("project_statuses")
        .insert({
          project_id: projectId,
          name: customColumnName,
          color: "#a855f7",
          category: "in_progress",
          position: 1500,
        });
      if (columnErr) {
        throw new Error(`Failed to seed custom column: ${columnErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", taskId);
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

    it("AS-479: creates the task with the custom column's real name as status, and the trigger links status_id to that column", async () => {
      const { createTask } = await import("@/lib/actions/tasks");

      currentTestUserId = memberUserId;
      const result = await createTask(
        projectId,
        "Quick-added into a custom column",
        null,
        customColumnName,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      createdTaskIds.push(result.data.id);
      expect(result.data.status).toBe(customColumnName);

      const { data: row } = await adminClient
        .from("tasks")
        .select("status, status_id, project_statuses(name)")
        .eq("id", result.data.id)
        .single();

      expect(row?.status).toBe(customColumnName);
      expect(row?.status_id).not.toBeNull();
      const linkedColumn = Array.isArray(row?.project_statuses)
        ? row?.project_statuses[0]
        : row?.project_statuses;
      expect(linkedColumn?.name).toBe(customColumnName);
    });

    it("negative: a column name that doesn't exist in this project is rejected, not silently inserted", async () => {
      const { createTask } = await import("@/lib/actions/tasks");

      currentTestUserId = memberUserId;
      const result = await createTask(
        projectId,
        "Should never be created",
        null,
        "Nonexistent Column",
      );

      expect(result.ok).toBe(false);
    });

    // AS-479's own permission siblings (F128/canWrite, F322) are already
    // fully covered by tests/integration/create-task.test.ts and
    // tests/integration/f322-single-task-project-visibility.test.ts against
    // this exact `createTask` action — this file only adds the negative
    // case specific to F248 (a viewer must not be able to quick-add,
    // enforced by the action, not merely by hiding the control).
    it("negative: a viewer cannot quick-add into any column, including the custom one", async () => {
      const { createTask } = await import("@/lib/actions/tasks");

      currentTestUserId = viewerUserId;
      const result = await createTask(
        projectId,
        "Viewer should not be able to create this",
        null,
        customColumnName,
      );

      expect(result.ok).toBe(false);
    });
  },
);
