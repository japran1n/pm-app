// Integration test for F041 (AS-065, AS-066), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/edit-task.test.ts.
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
  "updateTaskTags (F041: AS-065, AS-066)",
  () => {
    let adminClient: SupabaseClient;
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let memberUserId: string;
    let outsiderUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F041 Test Workspace",
          slug: `f041-tags-${uniqueSuffix}`,
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
          name: "F041 Other Workspace",
          slug: `f041-other-${uniqueSuffix}`,
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

      // An active member of `workspaceId` — the caller in the happy-path
      // scenarios.
      const memberEmail = `f041-member-${uniqueSuffix}@example.com`;
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

      // A member of a *different* workspace only — never a member of
      // `workspaceId`. Used as a non-member caller (negative case).
      const outsiderEmail = `f041-outsider-${uniqueSuffix}@example.com`;
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
            workspace_id: otherWorkspaceId,
            user_id: outsiderUserId,
            role: "member",
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
          name: `F041 Project ${uniqueSuffix}`,
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

    async function makeTask(tags: string[] = []): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F041 Task ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author_id: memberUserId,
          tags,
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed task: ${error?.message}`);
      }
      createdTaskIds.push(data.id);
      return data.id;
    }

    it("AS-065: an active workspace member can add tags to a task", async () => {
      const { updateTaskTags } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = memberUserId;

      const result = await updateTaskTags(taskId, ["backend", "urgent"]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.tags).toEqual(["backend", "urgent"]);

      const { data: row } = await adminClient
        .from("tasks")
        .select("tags")
        .eq("id", taskId)
        .single();
      expect(row?.tags).toEqual(["backend", "urgent"]);
    });

    it("AS-065: an active workspace member can remove one tag while keeping the rest", async () => {
      const { updateTaskTags } = await import("@/lib/actions/tasks");
      const taskId = await makeTask(["backend", "urgent", "bug"]);

      currentTestUserId = memberUserId;

      const result = await updateTaskTags(taskId, ["backend", "bug"]);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.tags).toEqual(["backend", "bug"]);
      expect(result.data.tags).not.toContain("urgent");
    });

    it("AS-066: setting tags to an empty array results in [] (not null) both in the return value and the stored row", async () => {
      const { updateTaskTags } = await import("@/lib/actions/tasks");
      const taskId = await makeTask(["backend", "urgent"]);

      currentTestUserId = memberUserId;

      const result = await updateTaskTags(taskId, []);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.tags).toEqual([]);
      expect(result.data.tags).not.toBeNull();

      const { data: row } = await adminClient
        .from("tasks")
        .select("tags")
        .eq("id", taskId)
        .single();
      expect(row?.tags).toEqual([]);
      expect(row?.tags).not.toBeNull();
    });

    it("AS-065: a task can be created/observed with zero tags — an empty list is a valid state, not an error", async () => {
      const taskId = await makeTask();
      const { data: row } = await adminClient
        .from("tasks")
        .select("tags")
        .eq("id", taskId)
        .single();
      expect(row?.tags).toEqual([]);
    });

    it("a user who is not a member of the task's workspace cannot update its tags", async () => {
      const { updateTaskTags } = await import("@/lib/actions/tasks");
      const taskId = await makeTask(["backend"]);

      currentTestUserId = outsiderUserId;

      const result = await updateTaskTags(taskId, ["hijacked"]);

      expect(result.ok).toBe(false);

      // Side-effect check: the task's tags were not changed.
      const { data: row } = await adminClient
        .from("tasks")
        .select("tags")
        .eq("id", taskId)
        .single();
      expect(row?.tags).toEqual(["backend"]);
      expect(row?.tags).not.toContain("hijacked");
    });

    it("a signed-out caller (no session) cannot update tags", async () => {
      const { updateTaskTags } = await import("@/lib/actions/tasks");
      const taskId = await makeTask(["backend"]);

      currentTestUserId = null;

      const result = await updateTaskTags(taskId, ["hijacked"]);

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("tags")
        .eq("id", taskId)
        .single();
      expect(row?.tags).toEqual(["backend"]);
    });

    it("rejects an empty-string tag (Zod validation, AS-146)", async () => {
      const { updateTaskTags } = await import("@/lib/actions/tasks");
      const taskId = await makeTask();

      currentTestUserId = memberUserId;

      const result = await updateTaskTags(taskId, ["good", "   "]);

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("tasks")
        .select("tags")
        .eq("id", taskId)
        .single();
      expect(row?.tags).toEqual([]);
    });
  },
);
