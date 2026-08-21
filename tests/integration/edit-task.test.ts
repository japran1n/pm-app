// Integration test for F037 (AS-054, AS-061, AS-060), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/assign-task.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client, resolving `auth.getUser()` to a real
// throwaway Supabase Auth user for the current test.

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

let currentTestUserId: string | null = null;

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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "editTask (F037: AS-054, AS-061, AS-060)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let otherProjectId: string;
    let authorUserId: string;
    let otherMemberUserId: string;
    let outsiderUserId: string;
    let viewerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F037 Test Workspace",
          slug: `f037-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F037 Other Workspace",
          slug: `f037-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) {
        throw new Error(
          `Failed to create other test workspace: ${otherWsErr?.message}`,
        );
      }
      otherWorkspaceId = otherWs.id;
      createdWorkspaceIds.push(otherWorkspaceId);

      // Task author — the caller in the "own task" edit scenario.
      const authorEmail = `f037-author-${uniqueSuffix}@example.com`;
      const { data: authorAuth, error: authorAuthErr } =
        await adminClient.auth.admin.createUser({
          email: authorEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (authorAuthErr || !authorAuth.user) {
        throw new Error(`Failed to create author user: ${authorAuthErr?.message}`);
      }
      authorUserId = authorAuth.user.id;
      createdUserIds.push(authorUserId);

      // A second active member of `workspaceId`, NOT the author and NOT
      // the assignee — proves AS-061 (any member can edit, no ownership
      // restriction).
      const otherMemberEmail = `f037-other-member-${uniqueSuffix}@example.com`;
      const { data: otherMemberAuth, error: otherMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: otherMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (otherMemberAuthErr || !otherMemberAuth.user) {
        throw new Error(
          `Failed to create other member user: ${otherMemberAuthErr?.message}`,
        );
      }
      otherMemberUserId = otherMemberAuth.user.id;
      createdUserIds.push(otherMemberUserId);

      // A member of a *different* workspace only — never a member of
      // `workspaceId`. Used as a non-member caller (AS-054 negative case).
      const outsiderEmail = `f037-outsider-${uniqueSuffix}@example.com`;
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      }
      outsiderUserId = outsiderAuth.user.id;
      createdUserIds.push(outsiderUserId);

      // F166 (AS-305): a viewer of `workspaceId` — used to prove the
      // server rejects an estimate change from a role that cannot edit
      // tasks at all (canEditTask excludes viewer/guest), not merely
      // hides the control in the UI.
      const viewerEmail = `f166-viewer-${uniqueSuffix}@example.com`;
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
            user_id: authorUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: otherMemberUserId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: otherWorkspaceId,
            user_id: outsiderUserId,
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
          name: `F037 Project ${uniqueSuffix}`,
          created_by: authorUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      // A second project in the SAME workspace, used only to prove
      // AS-060: editTask's update payload never touches project_id, so a
      // task never moves between projects, even if a raw update call
      // (bypassing the TS type) tried to smuggle a projectId-shaped field
      // through.
      const { data: proj2, error: proj2Err } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F037 Other Project ${uniqueSuffix}`,
          created_by: authorUserId,
        })
        .select("id")
        .single();
      if (proj2Err || !proj2) {
        throw new Error(`Failed to create second test project: ${proj2Err?.message}`);
      }
      otherProjectId = proj2.id;
      createdProjectIds.push(otherProjectId);
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

    async function makeTask(): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F037 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: authorUserId,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-054/AS-061: any active workspace member (not just the author) can edit a task", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      // otherMemberUserId did not author this task and is not assigned to
      // it — only workspace membership should matter (AS-061).
      currentTestUserId = otherMemberUserId;

      const result = await editTask(taskId, {
        title: "Updated by non-author member",
        description: "New description",
        priority: "high",
        dueDate: "2026-12-31",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.title).toBe("Updated by non-author member");
      expect(result.data.description).toBe("New description");
      expect(result.data.priority).toBe("high");
      expect(result.data.dueDate).toBe("2026-12-31");

      const { data: row } = await adminClient
        .from("tasks")
        .select("title, description, priority, due_date")
        .eq("id", taskId)
        .single();
      expect(row?.title).toBe("Updated by non-author member");
      expect(row?.description).toBe("New description");
      expect(row?.priority).toBe("high");
      expect(row?.due_date).toBe("2026-12-31");
    });

    it("AS-054: a caller who is not a member of the task's workspace cannot edit it", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = outsiderUserId;

      const result = await editTask(taskId, { title: "Hijacked title" });

      expect(result.ok).toBe(false);

      // Side-effect check: the task's title was not changed.
      const { data: row } = await adminClient
        .from("tasks")
        .select("title")
        .eq("id", taskId)
        .single();
      expect(row?.title).not.toBe("Hijacked title");
    });

    it("AS-054: a partial update only touches the provided fields, leaving others unchanged", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;

      const first = await editTask(taskId, {
        description: "First description",
        priority: "low",
      });
      expect(first.ok).toBe(true);

      const second = await editTask(taskId, { title: "Only title changes" });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.title).toBe("Only title changes");
      // description/priority set in the first call must survive untouched.
      expect(second.data.description).toBe("First description");
      expect(second.data.priority).toBe("low");
    });

    it("AS-060: EditTaskUpdates has no projectId field, so editTask can never move a task between projects", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;

      // Simulate a caller that bypasses the TS type by passing an extra,
      // unexpected `projectId`-shaped field through a raw object. Zod's
      // default (strip unknown keys) means this has zero effect on the
      // task's project_id — there is no code path in editTask that reads
      // or writes a projectId at all.
      const maliciousUpdates = {
        title: "Still editable",
        projectId: otherProjectId,
      } as unknown as Parameters<typeof editTask>[1];

      const result = await editTask(taskId, maliciousUpdates);

      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("tasks")
        .select("project_id, title")
        .eq("id", taskId)
        .single();
      expect(row?.project_id).toBe(projectId);
      expect(row?.project_id).not.toBe(otherProjectId);
      expect(row?.title).toBe("Still editable");
    });

    it("AS-054: editing a task in one workspace does not mutate rows in another workspace", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;

      const result = await editTask(taskId, { title: "Scoped edit" });
      expect(result.ok).toBe(true);

      // No task exists in the other workspace at all (nothing to check by
      // id), so this asserts the general side-effect contract: only the
      // targeted task row changed.
      const { data: row } = await adminClient
        .from("tasks")
        .select("id, title, project_id")
        .eq("id", taskId)
        .single();
      expect(row?.title).toBe("Scoped edit");
      expect(row?.project_id).toBe(projectId);
    });

    it("AS-298: a task can carry an estimate, set and read back in minutes", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;

      const result = await editTask(taskId, { estimateMinutes: 90 });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.estimateMinutes).toBe(90);

      const { data: row } = await adminClient
        .from("tasks")
        .select("estimate_minutes")
        .eq("id", taskId)
        .single();
      expect(row?.estimate_minutes).toBe(90);
    });

    it("AS-299: a zero estimate is rejected by the Zod schema, no write occurs", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;

      const result = await editTask(taskId, { estimateMinutes: 0 });

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("estimate_minutes")
        .eq("id", taskId)
        .single();
      expect(row?.estimate_minutes).toBeNull();
    });

    it("AS-299: a negative estimate is rejected by the Zod schema, no write occurs", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;

      const result = await editTask(taskId, { estimateMinutes: -30 });

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("estimate_minutes")
        .eq("id", taskId)
        .single();
      expect(row?.estimate_minutes).toBeNull();
    });

    it("AS-299: the database CHECK constraint rejects a zero/negative estimate even if Zod is bypassed", async () => {
      const taskId = await makeTask();

      const { error } = await adminClient
        .from("tasks")
        .update({ estimate_minutes: -5 })
        .eq("id", taskId);

      expect(error).not.toBeNull();
      expect(error?.message).toContain("tasks_estimate_minutes_positive");

      const { data: row } = await adminClient
        .from("tasks")
        .select("estimate_minutes")
        .eq("id", taskId)
        .single();
      expect(row?.estimate_minutes).toBeNull();
    });

    it("AS-305: a viewer cannot change a task's estimate, server-side, even with a direct call", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = viewerUserId;

      const result = await editTask(taskId, { estimateMinutes: 60 });

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("estimate_minutes")
        .eq("id", taskId)
        .single();
      expect(row?.estimate_minutes).toBeNull();
    });

    it("AS-298: setting estimateMinutes to null clears a previously set estimate", async () => {
      const { editTask } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = authorUserId;

      const first = await editTask(taskId, { estimateMinutes: 120 });
      expect(first.ok).toBe(true);

      const second = await editTask(taskId, { estimateMinutes: null });
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.data.estimateMinutes).toBeNull();
    });
  },
);
