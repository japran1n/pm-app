// Integration test for F112 (AS-169, AS-170), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/log-time-entry.test.ts.
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
  "editTimeEntry / deleteTimeEntry (F112: AS-169, AS-170)",
  () => {
    let adminClient: SupabaseClient;
    const createdTimeEntryIds: string[] = [];
    const createdTaskIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let taskId: string;
    let authorUserId: string;
    let otherMemberUserId: string;
    let adminUserId: string;
    let ownerUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F112 Test Workspace",
          slug: `f112-time-entries-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createMember(
        label: string,
        role: "owner" | "admin" | "member",
      ): Promise<string> {
        const email = `f112-${label}-${uniqueSuffix}@example.com`;
        const { data: auth, error: authErr } =
          await adminClient.auth.admin.createUser({
            email,
            password: "Test-password-1!",
            email_confirm: true,
          });
        if (authErr || !auth.user) {
          throw new Error(`Failed to create ${label} user: ${authErr?.message}`);
        }
        createdUserIds.push(auth.user.id);

        const { error: memberErr } = await adminClient
          .from("workspace_members")
          .insert({
            workspace_id: workspaceId,
            user_id: auth.user.id,
            role,
            status: "active",
          });
        if (memberErr) {
          throw new Error(`Failed to seed ${label} member: ${memberErr.message}`);
        }
        return auth.user.id;
      }

      authorUserId = await createMember("author", "member");
      otherMemberUserId = await createMember("other-member", "member");
      adminUserId = await createMember("admin", "admin");
      ownerUserId = await createMember("owner", "owner");

      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F112 Project ${uniqueSuffix}`,
          created_by: authorUserId,
        })
        .select("id")
        .single();
      if (projErr || !proj) {
        throw new Error(`Failed to create test project: ${projErr?.message}`);
      }
      createdProjectIds.push(proj.id);

      const { data: task, error: taskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: proj.id,
          title: `F112 Task ${uniqueSuffix}`,
          author_id: authorUserId,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        throw new Error(`Failed to create test task: ${taskErr?.message}`);
      }
      taskId = task.id;
      createdTaskIds.push(taskId);
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

    async function seedEntry() {
      const { data, error } = await adminClient
        .from("time_entries")
        .insert({
          task_id: taskId,
          user_id: authorUserId,
          minutes: 60,
          billable: true,
          entry_date: "2026-08-10",
          note: "original note",
        })
        .select("id")
        .single();
      if (error || !data) {
        throw new Error(`Failed to seed time entry: ${error?.message}`);
      }
      createdTimeEntryIds.push(data.id);
      return data.id as string;
    }

    it("AS-169: the entry's author can edit their own entry (minutes, billable, note, date)", async () => {
      const { editTimeEntry } = await import("@/lib/actions/time-entries");
      const entryId = await seedEntry();

      currentTestUserId = authorUserId;

      const result = await editTimeEntry(entryId, {
        minutes: 120,
        billable: false,
        note: "updated note",
        entryDate: "2026-08-11",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.minutes).toBe(120);
      expect(result.data.billable).toBe(false);
      expect(result.data.note).toBe("updated note");
      expect(result.data.entryDate).toBe("2026-08-11");

      const { data: row } = await adminClient
        .from("time_entries")
        .select("minutes, billable, note, entry_date")
        .eq("id", entryId)
        .single();
      expect(row?.minutes).toBe(120);
      expect(row?.billable).toBe(false);
      expect(row?.note).toBe("updated note");
      expect(row?.entry_date).toBe("2026-08-11");
    });

    it("AS-169: a different regular member cannot edit another's entry (server-side rejected)", async () => {
      const { editTimeEntry } = await import("@/lib/actions/time-entries");
      const entryId = await seedEntry();

      currentTestUserId = otherMemberUserId;

      const result = await editTimeEntry(entryId, { minutes: 999 });

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("time_entries")
        .select("minutes")
        .eq("id", entryId)
        .single();
      expect(row?.minutes).toBe(60);
    });

    it("AS-169: a workspace admin cannot edit another member's entry either — stricter than the app's usual admin-override model", async () => {
      const { editTimeEntry } = await import("@/lib/actions/time-entries");
      const entryId = await seedEntry();

      currentTestUserId = adminUserId;

      const result = await editTimeEntry(entryId, { minutes: 999 });

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("time_entries")
        .select("minutes")
        .eq("id", entryId)
        .single();
      expect(row?.minutes).toBe(60);
    });

    it("AS-169: a workspace owner cannot edit another member's entry either", async () => {
      const { editTimeEntry } = await import("@/lib/actions/time-entries");
      const entryId = await seedEntry();

      currentTestUserId = ownerUserId;

      const result = await editTimeEntry(entryId, { minutes: 999 });

      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("time_entries")
        .select("minutes")
        .eq("id", entryId)
        .single();
      expect(row?.minutes).toBe(60);
    });

    it("AS-170: the entry's author can delete their own entry", async () => {
      const { deleteTimeEntry } = await import("@/lib/actions/time-entries");
      const entryId = await seedEntry();

      currentTestUserId = authorUserId;

      const result = await deleteTimeEntry(entryId);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("time_entries")
        .select("id")
        .eq("id", entryId)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("AS-170: a workspace admin/owner can delete another member's entry", async () => {
      const { deleteTimeEntry } = await import("@/lib/actions/time-entries");
      const entryId = await seedEntry();

      currentTestUserId = adminUserId;

      const result = await deleteTimeEntry(entryId);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("time_entries")
        .select("id")
        .eq("id", entryId)
        .maybeSingle();
      expect(row).toBeNull();
    });

    it("AS-170: a different regular member cannot delete another's entry", async () => {
      const { deleteTimeEntry } = await import("@/lib/actions/time-entries");
      const entryId = await seedEntry();

      currentTestUserId = otherMemberUserId;

      const result = await deleteTimeEntry(entryId);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("time_entries")
        .select("id")
        .eq("id", entryId)
        .maybeSingle();
      expect(row).not.toBeNull();
    });
  },
);
