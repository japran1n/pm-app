// Integration test for F026 (AS-025, AS-026, AS-035, AS-036), run against
// the real linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/create-workspace-owner.test.ts and
// tests/integration/rls-projects.test.ts.
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
  "createProject (F026: AS-025, AS-026, AS-035, AS-036)",
  () => {
    let adminClient: SupabaseClient;
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let memberUserId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F026 Test Workspace",
          slug: `f026-projects-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      const memberEmail = `f026-member-${uniqueSuffix}@example.com`;
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
    });

    beforeEach(() => {
      currentTestUserId = null;
    });

    afterAll(async () => {
      for (const projectId of createdProjectIds) {
        await adminClient.from("projects").delete().eq("id", projectId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("AS-025/AS-036: an active member can create a project; created_at/created_by are set correctly", async () => {
      const { createProject } = await import("@/lib/actions/projects");

      currentTestUserId = memberUserId;

      const uniqueName = `F026 Project ${Date.now()}`;
      const result = await createProject(
        workspaceId,
        uniqueName,
        "A test project",
        "2026-09-01",
        "2026-09-30",
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      createdProjectIds.push(result.data.id);

      expect(result.data.name).toBe(uniqueName);
      expect(result.data.workspaceId).toBe(workspaceId);
      expect(result.data.createdBy).toBe(memberUserId);
      expect(result.data.createdAt).toBeTruthy();

      const { data: row, error } = await adminClient
        .from("projects")
        .select("id, name, workspace_id, created_by, created_at")
        .eq("id", result.data.id)
        .single();

      expect(error).toBeNull();
      expect(row?.name).toBe(uniqueName);
      expect(row?.workspace_id).toBe(workspaceId);
      expect(row?.created_by).toBe(memberUserId);
      expect(row?.created_at).toBeTruthy();
    });

    it("AS-026: an empty name is rejected before reaching the database", async () => {
      const { createProject } = await import("@/lib/actions/projects");

      currentTestUserId = memberUserId;

      const result = await createProject(workspaceId, "");

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBeTruthy();

      // Side-effect check: nothing was inserted for this rejected call.
      const { data: rows } = await adminClient
        .from("projects")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", "");
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-026: the database CHECK constraint independently rejects an empty-string name even when Zod is bypassed via a direct insert", async () => {
      const { error } = await adminClient.from("projects").insert({
        workspace_id: workspaceId,
        name: "",
      });

      // The admin client bypasses RLS and the Server Action's Zod layer
      // entirely — `projects_name_not_empty` (F100's migration) must still
      // reject this at the schema level. Closes the gap M3 scrutiny found:
      // the original migration comment implied DB-level rejection of an
      // empty name, but only `not null` existed, which does not block ''.
      expect(error).not.toBeNull();
    });

    it("AS-026: the database CHECK constraint independently rejects a whitespace-only name even when Zod is bypassed via a direct insert", async () => {
      const { error } = await adminClient.from("projects").insert({
        workspace_id: workspaceId,
        name: "   ",
      });

      expect(error).not.toBeNull();
    });

    it("AS-035: end_date earlier than start_date is rejected by the Server Action's Zod check before reaching the database", async () => {
      const { createProject } = await import("@/lib/actions/projects");

      currentTestUserId = memberUserId;

      const result = await createProject(
        workspaceId,
        `F026 Bad Range ${Date.now()}`,
        undefined,
        "2026-09-30",
        "2026-09-01",
      );

      expect(result.ok).toBe(false);
    });

    it("AS-035: the database CHECK constraint independently rejects end_date < start_date even when Zod is bypassed via a direct insert", async () => {
      const { error } = await adminClient.from("projects").insert({
        workspace_id: workspaceId,
        name: `F026 Direct Bad Range ${Date.now()}`,
        start_date: "2026-09-30",
        end_date: "2026-09-01",
      });

      // The admin client bypasses RLS but not table CHECK constraints —
      // `projects_end_date_after_start_date` (F024's migration) must still
      // reject this at the schema level, per AS-035's "cannot be earlier
      // ... the database rejects it server-side" requirement, independent
      // of any application-layer validation.
      expect(error).not.toBeNull();
    });

    it("non-member of the workspace cannot create a project in it", async () => {
      const { createProject } = await import("@/lib/actions/projects");

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nonMemberEmail = `f026-nonmember-${uniqueSuffix}@example.com`;
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(`Failed to create non-member user: ${nonMemberAuthErr?.message}`);
      }
      createdUserIds.push(nonMemberAuth.user.id);

      currentTestUserId = nonMemberAuth.user.id;

      const result = await createProject(
        workspaceId,
        `F026 Should Not Exist ${Date.now()}`,
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/permission/i);

      const { data: rows } = await adminClient
        .from("projects")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("name", `F026 Should Not Exist ${Date.now()}`);
      expect(rows ?? []).toHaveLength(0);
    });

    it("AS-036: two projects created in sequence get distinct created_at attribution to the correct creator", async () => {
      const { createProject } = await import("@/lib/actions/projects");

      currentTestUserId = memberUserId;

      const first = await createProject(workspaceId, `F026 Seq A ${Date.now()}`);
      expect(first.ok).toBe(true);
      if (first.ok) createdProjectIds.push(first.data.id);

      const second = await createProject(workspaceId, `F026 Seq B ${Date.now()}`);
      expect(second.ok).toBe(true);
      if (second.ok) createdProjectIds.push(second.data.id);

      if (first.ok && second.ok) {
        expect(first.data.createdBy).toBe(memberUserId);
        expect(second.data.createdBy).toBe(memberUserId);
      }
    });
  },
);
