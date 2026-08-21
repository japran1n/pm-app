// Integration test for F160 (AS-289, AS-290), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/assign-task.test.ts and assignee-backfill.test.ts.
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
    "F160: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "F160 multi-assignee actions (AS-289, AS-290)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string; // workspace-visible project
    let privateProjectId: string; // private project, no explicit members
    let memberA: string;
    let memberB: string;
    let memberC: string;
    let guestNoAccess: string; // active workspace member, no access to privateProjectId

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F160 Test Workspace", slug: `f160-ws-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function makeUser(label: string) {
        const email = `f160-${label}-${suffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        createdUserIds.push(data.user.id);
        return data.user.id;
      }

      memberA = await makeUser("member-a");
      memberB = await makeUser("member-b");
      memberC = await makeUser("member-c");
      guestNoAccess = await makeUser("guest-no-access");

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          { workspace_id: workspaceId, user_id: memberA, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: memberB, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: memberC, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: guestNoAccess, role: "guest", status: "active" },
        ]);
      if (memberInsertErr) {
        throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
      }

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F160 Project ${suffix}`,
          created_by: memberA,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: privateProj, error: privateProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F160 Private Project ${suffix}`,
          created_by: memberA,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateProjErr || !privateProj) {
        throw new Error(
          `Failed to create private test project: ${privateProjErr?.message}`,
        );
      }
      privateProjectId = privateProj.id;
      createdProjectIds.push(privateProjectId);

      // Only memberA is an explicit member of the private project — memberB
      // and guestNoAccess are active workspace members but have no
      // project-level access to it.
      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: memberA,
        project_role: "member",
        added_by: memberA,
      });
      if (pmErr) {
        throw new Error(`Failed to seed project_members: ${pmErr.message}`);
      }
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const taskId of createdTaskIds) {
        await adminClient.from("task_assignees").delete().eq("task_id", taskId);
        await adminClient.from("tasks").delete().eq("id", taskId);
      }
      for (const pId of createdProjectIds) {
        await adminClient.from("project_members").delete().eq("project_id", pId);
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

    async function makeTask(inProjectId: string = projectId): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: inProjectId,
          title: `F160 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberA,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-289: an assignee can be removed without affecting the others (3 assignees, remove one)", async () => {
      const { setTaskAssignees, removeTaskAssignee } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeTask();
      currentTestUserId = memberA;

      const setResult = await setTaskAssignees(taskId, [memberA, memberB, memberC]);
      expect(setResult.ok).toBe(true);
      if (!setResult.ok) return;
      expect(new Set(setResult.data.assigneeIds)).toEqual(
        new Set([memberA, memberB, memberC]),
      );

      const removeResult = await removeTaskAssignee(taskId, memberB);
      expect(removeResult.ok).toBe(true);
      if (!removeResult.ok) return;
      expect(new Set(removeResult.data.assigneeIds)).toEqual(
        new Set([memberA, memberC]),
      );

      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      const remainingIds = (rows ?? []).map((r) => r.user_id).sort();
      expect(remainingIds).toEqual([memberA, memberC].sort());
    });

    it("AS-289: removing a non-assigned user is a no-op that leaves current assignees untouched", async () => {
      const { setTaskAssignees, removeTaskAssignee } = await import(
        "@/lib/actions/tasks"
      );
      const taskId = await makeTask();
      currentTestUserId = memberA;

      await setTaskAssignees(taskId, [memberA, memberB]);

      const removeResult = await removeTaskAssignee(taskId, memberC);
      expect(removeResult.ok).toBe(true);
      if (!removeResult.ok) return;
      expect(new Set(removeResult.data.assigneeIds)).toEqual(
        new Set([memberA, memberB]),
      );
    });

    it("AS-290: only members with access to the task's project can be assigned — a guest without private-project access is rejected via addTaskAssignee", async () => {
      const { addTaskAssignee } = await import("@/lib/actions/tasks");
      const taskId = await makeTask(privateProjectId);
      currentTestUserId = memberA; // caller has access (explicit project_members row)

      const result = await addTaskAssignee(taskId, guestNoAccess);
      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-290: only members with access to the task's project can be assigned — an active workspace member without private-project access is rejected via setTaskAssignees", async () => {
      const { setTaskAssignees } = await import("@/lib/actions/tasks");
      const taskId = await makeTask(privateProjectId);
      currentTestUserId = memberA;

      const result = await setTaskAssignees(taskId, [memberA, memberB]);
      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-290: a member with an explicit project_members row on a private project CAN be assigned", async () => {
      const { addTaskAssignee } = await import("@/lib/actions/tasks");
      const taskId = await makeTask(privateProjectId);
      currentTestUserId = memberA;

      const result = await addTaskAssignee(taskId, memberA);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.assigneeIds).toEqual([memberA]);
    });

    it("addTaskAssignee is a no-op (ok, no duplicate row) when the user is already assigned", async () => {
      const { addTaskAssignee } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();
      currentTestUserId = memberA;

      const first = await addTaskAssignee(taskId, memberB);
      expect(first.ok).toBe(true);

      const second = await addTaskAssignee(taskId, memberB);
      expect(second.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", taskId);
      expect(rows ?? []).toHaveLength(1);
    });

    it("setTaskAssignees keeps tasks.assignee_id (the deprecated mirror column) in sync with the first assignee", async () => {
      const { setTaskAssignees } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();
      currentTestUserId = memberA;

      const setResult = await setTaskAssignees(taskId, [memberA, memberB]);
      expect(setResult.ok).toBe(true);
      if (!setResult.ok) return;

      const { data: taskRow } = await adminClient
        .from("tasks")
        .select("assignee_id")
        .eq("id", taskId)
        .single();
      expect(taskRow?.assignee_id).toBe(setResult.data.mirrorAssigneeId);
      expect(taskRow?.assignee_id).not.toBeNull();

      const clearResult = await setTaskAssignees(taskId, []);
      expect(clearResult.ok).toBe(true);
      if (!clearResult.ok) return;
      expect(clearResult.data.mirrorAssigneeId).toBeNull();

      const { data: clearedTaskRow } = await adminClient
        .from("tasks")
        .select("assignee_id")
        .eq("id", taskId)
        .single();
      expect(clearedTaskRow?.assignee_id).toBeNull();
    });

    it("a caller who is not a member of the task's workspace cannot call the multi-assignee actions", async () => {
      const { addTaskAssignee, removeTaskAssignee, setTaskAssignees } =
        await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      const { data: outsider, error: outsiderErr } =
        await adminClient.auth.admin.createUser({
          email: `f160-outsider-${Date.now()}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (outsiderErr || !outsider.user) {
        throw new Error(`Failed to create outsider user: ${outsiderErr?.message}`);
      }
      createdUserIds.push(outsider.user.id);
      currentTestUserId = outsider.user.id;

      const addResult = await addTaskAssignee(taskId, memberA);
      expect(addResult.ok).toBe(false);

      const removeResult = await removeTaskAssignee(taskId, memberA);
      expect(removeResult.ok).toBe(false);

      const setResult = await setTaskAssignees(taskId, [memberA]);
      expect(setResult.ok).toBe(false);
    });
  },
);
