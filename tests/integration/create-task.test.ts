// Integration test for F035 (AS-043, AS-044, AS-045, AS-046), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/create-project.test.ts.
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
  "createTask (F035: AS-043, AS-044, AS-045, AS-046)",
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
          name: "F035 Test Workspace",
          slug: `f035-tasks-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f035-member-${uniqueSuffix}@example.com`;
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
          name: `F035 Project ${uniqueSuffix}`,
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

    it("AS-043/AS-045/AS-058: an active member can create a task with just a title; status defaults to 'todo' and author_id is set", async () => {
      const { createTask } = await import("@/lib/actions/tasks");

      currentTestUserId = memberUserId;

      const uniqueTitle = `F035 Task ${Date.now()}`;
      const result = await createTask(projectId, uniqueTitle);

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdTaskIds.push(result.data.id);

      expect(result.data.title).toBe(uniqueTitle);
      expect(result.data.projectId).toBe(projectId);
      expect(result.data.status).toBe("todo");
      expect(result.data.authorId).toBe(memberUserId);

      const { data: row, error } = await adminClient
        .from("tasks")
        .select("id, title, project_id, status, author_id")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      expect(row?.title).toBe(uniqueTitle);
      expect(row?.project_id).toBe(projectId);
      expect(row?.status).toBe("todo");
      expect(row?.author_id).toBe(memberUserId);
    });

    it("AS-046: an active member can create a task with description, priority, assignee, and due date", async () => {
      const { createTask } = await import("@/lib/actions/tasks");

      currentTestUserId = memberUserId;

      const uniqueTitle = `F035 Full Task ${Date.now()}`;
      const result = await createTask(
        projectId,
        uniqueTitle,
        "A detailed description",
        "in_progress",
        "high",
        memberUserId,
        "2026-09-15",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdTaskIds.push(result.data.id);

      expect(result.data.description).toBe("A detailed description");
      expect(result.data.status).toBe("in_progress");
      expect(result.data.priority).toBe("high");
      expect(result.data.assigneeId).toBe(memberUserId);
      expect(result.data.dueDate).toBe("2026-09-15");
    });

    it("AS-044: an empty title is rejected before reaching the database", async () => {
      const { createTask } = await import("@/lib/actions/tasks");

      currentTestUserId = memberUserId;

      const result = await createTask(projectId, "");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      // Side-effect check: nothing was inserted for this rejected call.
      const { data: rows } = await adminClient
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("title", "");
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-044: the database CHECK constraint independently rejects an empty-string title even when Zod is bypassed via a direct insert", async () => {
      const { error } = await adminClient.from("tasks").insert({
        project_id: projectId,
        title: "",
        author_id: memberUserId,
      });

      expect(error).not.toBeNull();
    });

    it("non-member of the workspace cannot create a task in one of its projects", async () => {
      const { createTask } = await import("@/lib/actions/tasks");

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nonMemberEmail = `f035-nonmember-${uniqueSuffix}@example.com`;
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(
          `Failed to create non-member user: ${nonMemberAuthErr?.message}`,
        );
      }
      createdUserIds.push(nonMemberAuth.user.id);

      currentTestUserId = nonMemberAuth.user.id;

      const result = await createTask(projectId, `F035 Nonmember Task ${Date.now()}`);

      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("author_id", nonMemberAuth.user.id);
      expect(rows ?? []).toHaveLength(0);
    });
  },
);
