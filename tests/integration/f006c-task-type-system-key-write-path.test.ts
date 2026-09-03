// Integration test for F006c (missions/20260903-portal, AS-014): a real
// write path for `task_types.system_key`, run against the real linked
// Supabase project.
//
// Before this feature `system_key` had no write path anywhere in the
// app (M1-scrutiny.md's B5: "grep across app/, components/, lib/ finds
// system_key only in the migration, lib/queries/task-types.ts (read),
// database.types.ts, and task-type-manager.tsx's own read-only badge")
// — an existing workspace whose page type was named anything other than
// what the backfill matched had a permanently empty portal Pages view
// fixable only by hand-run SQL. `updateTaskType` now accepts an optional
// `systemKey`, workspace-admin gated, same as name/color.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "F006c: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
} = { auth: { getUser: async () => ({ data: { user: null } }) } };

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveCreds)(
  "task_types.system_key write path (F006c, AS-014)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceId: string;
    let ownerEmail: string;
    let memberEmail: string;
    const password = "Test-password-1!";

    async function signInAs(email: string) {
      const signInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await signInClient.auth.signInWithPassword({ email, password });
      if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
      currentTestClient = signInClient as unknown as typeof currentTestClient;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F006c Workspace", slug: `f006c-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createUser(label: string) {
        const email = `f006c-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`Failed to create ${label} user: ${error?.message}`);
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email };
      }

      const owner = await createUser("owner");
      ownerEmail = owner.email;
      const member = await createUser("member");
      memberEmail = member.email;

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: owner.id, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: member.id, role: "member", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
    });

    beforeEach(async () => {
      currentTestClient = { auth: { getUser: async () => ({ data: { user: null } }) } };
      // Every test seeds its own task types via `makeType` — clear the
      // workspace's task_types between tests so the partial unique index
      // `task_types_workspace_id_system_key_idx` (at most one `page`-
      // tagged row per workspace) never sees a leftover row from a
      // PRIOR test in this same shared workspace.
      await adminClient.from("task_types").delete().eq("workspace_id", workspaceId);
    });

    afterAll(async () => {
      await adminClient.from("task_types").delete().eq("workspace_id", workspaceId);
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    async function makeType(name: string, systemKey: string | null = null) {
      const { data, error } = await adminClient
        .from("task_types")
        .insert({ workspace_id: workspaceId, name, color: "#3670e1", system_key: systemKey })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Failed to seed task type: ${error?.message}`);
      return data.id as string;
    }

    it("test_AS_014_an_admin_can_tag_a_type_named_Sida_as_the_portal_page_type_and_it_persists", async () => {
      const typeId = await makeType("Sida");
      await signInAs(ownerEmail);

      const { updateTaskType } = await import("@/lib/actions/task-types");
      const result = await updateTaskType({ taskTypeId: typeId, systemKey: "page" });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("task_types")
        .select("system_key, name")
        .eq("id", typeId)
        .single();
      expect(row?.system_key).toBe("page");
      expect(row?.name).toBe("Sida");
    });

    it("test_AS_014_an_admin_can_clear_a_type's_portal_role", async () => {
      const typeId = await makeType("Old page type", "page");
      await signInAs(ownerEmail);

      const { updateTaskType } = await import("@/lib/actions/task-types");
      const result = await updateTaskType({ taskTypeId: typeId, systemKey: null });
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("task_types")
        .select("system_key")
        .eq("id", typeId)
        .single();
      expect(row?.system_key).toBeNull();
    });

    it("test_AS_014_tagging_a_second_type_as_the_page_type_returns_a_friendly_error_not_a_raw_constraint_violation", async () => {
      await makeType("Existing page type", "page");
      const secondTypeId = await makeType("Sida (second type)");
      await signInAs(ownerEmail);

      const { updateTaskType } = await import("@/lib/actions/task-types");
      const result = await updateTaskType({ taskTypeId: secondTypeId, systemKey: "page" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).not.toMatch(/23505|constraint|duplicate key/i);
      expect(result.error).toMatch(/already tagged/i);

      const { data: row } = await adminClient
        .from("task_types")
        .select("system_key")
        .eq("id", secondTypeId)
        .single();
      expect(row?.system_key).toBeNull();
    });

    it("test_AS_014_a_plain_member_cannot_set_a_type's_portal_role", async () => {
      const typeId = await makeType("Sida (member test)");
      await signInAs(memberEmail);

      const { updateTaskType } = await import("@/lib/actions/task-types");
      const result = await updateTaskType({ taskTypeId: typeId, systemKey: "page" });
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("task_types")
        .select("system_key")
        .eq("id", typeId)
        .single();
      expect(row?.system_key).toBeNull();
    });
  },
);
