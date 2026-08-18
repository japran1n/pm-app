// Integration test for F110 (AS-161, AS-162, AS-163), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/add-comment.test.ts.
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
  "logTimeEntry (F110: AS-161, AS-162, AS-163)",
  () => {
    let adminClient: SupabaseClient;
    const createdTimeEntryIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let taskId: string;
    let memberUserId: string;

    // A second, entirely separate workspace/project/task/member set, used
    // only for the AS-163 cross-workspace test — a real second workspace,
    // not a mocked one, so the test exercises the actual server-side
    // workspace lookup + membership re-check rather than a stubbed
    // decision.
    let otherWorkspaceId: string;
    let otherTaskId: string;
    let otherWorkspaceMemberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F110 Test Workspace",
          slug: `f110-time-entries-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f110-member-${uniqueSuffix}@example.com`;
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
          name: `F110 Project ${uniqueSuffix}`,
          created_by: memberUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F110 Task ${uniqueSuffix}`,
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;
      createdTaskIds.push(taskId);

      // Second workspace, entirely separate, with its own active member and
      // task — used only by the AS-163 cross-workspace test below.
      const otherSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-other`;

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F110 Other Test Workspace",
          slug: `f110-time-entries-other-${otherSuffix}`,
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

      const otherMemberEmail = `f110-other-member-${otherSuffix}@example.com`;
      const { data: otherMemberAuth, error: otherMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: otherMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (otherMemberAuthErr || !otherMemberAuth.user) {
        throw new Error(
          `Failed to create other-workspace member user: ${otherMemberAuthErr?.message}`,
        );
      }
      otherWorkspaceMemberUserId = otherMemberAuth.user.id;
      createdUserIds.push(otherWorkspaceMemberUserId);

      const { error: otherMemberInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: otherWorkspaceId,
          user_id: otherWorkspaceMemberUserId,
          role: "member",
          status: "active",
        });
      if (otherMemberInsertErr) {
        throw new Error(
          `Failed to seed other-workspace member: ${otherMemberInsertErr.message}`,
        );
      }

      const { data: otherProj, error: otherProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: otherWorkspaceId,
          name: `F110 Other Project ${otherSuffix}`,
          created_by: otherWorkspaceMemberUserId,
        })
        .select("id")
        .single();
      if (otherProjErr || !otherProj) {
        throw new Error(
          `Failed to create other test project: ${otherProjErr?.message}`,
        );
      }
      createdProjectIds.push(otherProj.id);

      const { data: otherTask, error: otherTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: otherProj.id,
          title: `F110 Other Task ${otherSuffix}`,
          author_id: otherWorkspaceMemberUserId,
        })
        .select("id")
        .single();
      if (otherTaskErr || !otherTask) {
        throw new Error(
          `Failed to create other test task: ${otherTaskErr?.message}`,
        );
      }
      otherTaskId = otherTask.id;
      createdTaskIds.push(otherTaskId);
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const entryId of createdTimeEntryIds) {
        await adminClient.from("time_entries").delete().eq("id", entryId);
      }
      for (const tId of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", tId);
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

    it("AS-161: an active workspace member can log a valid manual time entry on a task", async () => {
      const { logTimeEntry } = await import("@/lib/actions/time-entries");

      currentTestUserId = memberUserId;

      const result = await logTimeEntry(taskId, 90, true, "2026-08-15", "worked on it");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdTimeEntryIds.push(result.data.id);

      expect(result.data.taskId).toBe(taskId);
      expect(result.data.userId).toBe(memberUserId);
      expect(result.data.minutes).toBe(90);
      expect(result.data.billable).toBe(true);
      expect(result.data.entryDate).toBe("2026-08-15");
      expect(result.data.note).toBe("worked on it");

      const { data: row, error } = await adminClient
        .from("time_entries")
        .select("id, task_id, user_id, minutes, billable, entry_date, note")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      expect(row?.task_id).toBe(taskId);
      expect(row?.user_id).toBe(memberUserId);
      expect(row?.minutes).toBe(90);
      expect(row?.billable).toBe(true);
      expect(row?.note).toBe("worked on it");
    });

    it("AS-161: note is optional and defaults to null when omitted", async () => {
      const { logTimeEntry } = await import("@/lib/actions/time-entries");

      currentTestUserId = memberUserId;

      const result = await logTimeEntry(taskId, 30, false, "2026-08-16");

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdTimeEntryIds.push(result.data.id);
      expect(result.data.note).toBeNull();
      expect(result.data.billable).toBe(false);
    });

    it("AS-162: zero minutes is rejected via Zod before reaching the database (client-side path)", async () => {
      const { logTimeEntrySchema } = await import(
        "@/lib/validation/time-entries"
      );
      const { logTimeEntry } = await import("@/lib/actions/time-entries");

      const clientParsed = logTimeEntrySchema.safeParse({
        taskId,
        minutes: 0,
        billable: true,
        entryDate: "2026-08-15",
      });
      expect(clientParsed.success).toBe(false);

      currentTestUserId = memberUserId;

      const result = await logTimeEntry(taskId, 0, true, "2026-08-15");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      const { data: rows } = await adminClient
        .from("time_entries")
        .select("id")
        .eq("task_id", taskId)
        .eq("minutes", 0);
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-162: negative minutes is rejected via Zod before reaching the database (client-side path)", async () => {
      const { logTimeEntrySchema } = await import(
        "@/lib/validation/time-entries"
      );
      const { logTimeEntry } = await import("@/lib/actions/time-entries");

      const clientParsed = logTimeEntrySchema.safeParse({
        taskId,
        minutes: -15,
        billable: true,
        entryDate: "2026-08-15",
      });
      expect(clientParsed.success).toBe(false);

      currentTestUserId = memberUserId;

      const result = await logTimeEntry(taskId, -15, true, "2026-08-15");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      const { data: rows } = await adminClient
        .from("time_entries")
        .select("id")
        .eq("task_id", taskId)
        .eq("minutes", -15);
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-163: a member of one workspace cannot log time on a task belonging to a different workspace", async () => {
      const { logTimeEntry } = await import("@/lib/actions/time-entries");

      // memberUserId is an active member of `workspaceId` only —
      // `otherTaskId` belongs to the entirely separate `otherWorkspaceId`.
      // This is a real cross-workspace attempt: both workspaces, both
      // tasks, and both members are genuinely persisted rows, not mocked
      // decisions.
      currentTestUserId = memberUserId;

      const result = await logTimeEntry(otherTaskId, 60, true, "2026-08-15");

      expect(result.ok).toBe(false);

      const { data: rows } = await adminClient
        .from("time_entries")
        .select("id")
        .eq("task_id", otherTaskId)
        .eq("user_id", memberUserId);
      expect(rows ?? []).toHaveLength(0);
    });
  },
);
