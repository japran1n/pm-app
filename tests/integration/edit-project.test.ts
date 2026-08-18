// Integration test for F028 (AS-029, AS-037), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/create-project.test.ts.
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

describe.skipIf(!haveAdminCreds)("editProject (F028: AS-029, AS-037)", () => {
  let adminClient: SupabaseClient;
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;
  let creatorUserId: string;
  let otherMemberUserId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "F028 Test Workspace",
        slug: `f028-projects-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    const creatorEmail = `f028-creator-${uniqueSuffix}@example.com`;
    const { data: creatorAuth, error: creatorAuthErr } =
      await adminClient.auth.admin.createUser({
        email: creatorEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (creatorAuthErr || !creatorAuth.user) {
      throw new Error(`Failed to create creator user: ${creatorAuthErr?.message}`);
    }
    creatorUserId = creatorAuth.user.id;
    createdUserIds.push(creatorUserId);

    const otherEmail = `f028-other-member-${uniqueSuffix}@example.com`;
    const { data: otherAuth, error: otherAuthErr } =
      await adminClient.auth.admin.createUser({
        email: otherEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (otherAuthErr || !otherAuth.user) {
      throw new Error(`Failed to create other member user: ${otherAuthErr?.message}`);
    }
    otherMemberUserId = otherAuth.user.id;
    createdUserIds.push(otherMemberUserId);

    const { error: membersInsertErr } = await adminClient
      .from("workspace_members")
      .insert([
        { workspace_id: workspaceId, user_id: creatorUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
      ]);
    if (membersInsertErr) {
      throw new Error(`Failed to seed members: ${membersInsertErr.message}`);
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

  async function seedProject(namePrefix: string) {
    const { data: inserted, error } = await adminClient
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: `${namePrefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        description: "Original description",
        created_by: creatorUserId,
      })
      .select("id, name, description, start_date, end_date, created_at, updated_at")
      .single();
    if (error || !inserted) {
      throw new Error(`Failed to seed project: ${error?.message}`);
    }
    createdProjectIds.push(inserted.id);
    return inserted;
  }

  it("AS-029: any workspace member (not just the creator) can edit a project's name/description/dates", async () => {
    const { editProject } = await import("@/lib/actions/projects");

    const project = await seedProject("F028 Edit By Other Member");

    // The editing user is `otherMemberUserId`, which did NOT create this
    // project (created_by = creatorUserId) — asserts no per-project
    // ownership restriction beyond workspace membership.
    currentTestUserId = otherMemberUserId;

    const newName = `F028 Edited Name ${Date.now()}`;
    const result = await editProject(project.id, workspaceId, {
      name: newName,
      description: "Updated description",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.name).toBe(newName);
    expect(result.data.description).toBe("Updated description");
    expect(result.data.startDate).toBe("2026-10-01");
    expect(result.data.endDate).toBe("2026-10-31");

    const { data: row, error } = await adminClient
      .from("projects")
      .select("name, description, start_date, end_date")
      .eq("id", project.id)
      .single();

    expect(error).toBeNull();
    expect(row?.name).toBe(newName);
    expect(row?.description).toBe("Updated description");
    expect(row?.start_date).toBe("2026-10-01");
    expect(row?.end_date).toBe("2026-10-31");
  });

  it("AS-037: editing a project updates updated_at automatically (via the DB trigger, not app code)", async () => {
    const { editProject } = await import("@/lib/actions/projects");

    const project = await seedProject("F028 Updated At");
    const originalUpdatedAt = project.updated_at;

    // Ensure a measurable time delta between insert and edit.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    currentTestUserId = creatorUserId;

    const result = await editProject(project.id, workspaceId, {
      name: `${project.name} (edited)`,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.updatedAt).toBeTruthy();
    expect(new Date(result.data.updatedAt).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime(),
    );

    const { data: row } = await adminClient
      .from("projects")
      .select("updated_at")
      .eq("id", project.id)
      .single();

    expect(new Date(row!.updated_at).getTime()).toBeGreaterThan(
      new Date(originalUpdatedAt).getTime(),
    );
  });

  it("a non-member of the workspace cannot edit a project in it", async () => {
    const { editProject } = await import("@/lib/actions/projects");

    const project = await seedProject("F028 Should Not Edit");
    const originalName = project.name;

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nonMemberEmail = `f028-nonmember-${uniqueSuffix}@example.com`;
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

    const result = await editProject(project.id, workspaceId, {
      name: "Should Not Apply",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/permission/i);

    // Side-effect check: the project row is untouched.
    const { data: row } = await adminClient
      .from("projects")
      .select("name")
      .eq("id", project.id)
      .single();
    expect(row?.name).toBe(originalName);
  });

  it("AS-029/AS-035: an edit that would put end_date before start_date is rejected without mutating the row", async () => {
    const { editProject } = await import("@/lib/actions/projects");

    const project = await seedProject("F028 Bad Range");

    currentTestUserId = creatorUserId;

    // Seed a valid start_date first so the partial-update date check has
    // something to compare the new end_date against.
    const seeded = await editProject(project.id, workspaceId, {
      startDate: "2026-11-01",
    });
    expect(seeded.ok).toBe(true);

    const result = await editProject(project.id, workspaceId, {
      endDate: "2026-10-01",
    });

    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("projects")
      .select("end_date")
      .eq("id", project.id)
      .single();
    expect(row?.end_date).toBeNull();
  });
});
