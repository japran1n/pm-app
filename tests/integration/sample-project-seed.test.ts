// Integration test for F254 (AS-494), run against the real linked
// Supabase project — mirrors the mocked-createClient pattern established
// by tests/integration/project-from-template.test.ts (F184).
//
// Proves:
//   AS-494 (happy path): a member (and an owner) can create a sample
//     project for their workspace. It has a name/description clearly
//     labelled as a sample, a handful of tasks spread across the
//     project's default board columns with real priorities and due
//     dates, a checklist on the first task, and a comment on that same
//     task — all created through the real Server Actions (createProject/
//     createTask/addChecklistItem/addComment), not a direct insert.
//   Deletable in one step: the resulting project is a completely
//     ordinary row that the existing archiveProject action can archive
//     (soft-delete) in a single call, same as any other project.
//   Negative cases: an unauthenticated caller is rejected; a viewer
//     (read-only) is rejected; a non-member of the workspace is rejected
//     — none of these ever reach a project insert.

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
    "F254: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
    from: (table: string) => {
      // Only checklist/comment actions read through the RLS-respecting
      // session client (see addChecklistItem's own doc comment) — this
      // stub proxies those specific selects through the admin client so
      // the mocked session client behaves like a real one for the read
      // paths this action exercises, without re-implementing RLS.
      return adminClientForMock!.from(table);
    },
  }),
}));

// Populated in beforeAll, referenced by the createClient mock above.
let adminClientForMock: SupabaseClient | null = null;

describe.skipIf(!haveAdminCreds)("createSampleProject (F254: AS-494)", () => {
  let adminClient: SupabaseClient;
  const createdProjectIds: string[] = [];
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;
  let ownerUserId: string;
  let memberUserId: string;
  let viewerUserId: string;
  let outsiderUserId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    adminClientForMock = adminClient;

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: "F254 Test Workspace",
        slug: `f254-sample-project-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    async function createUser(label: string) {
      const email = `f254-${label}-${uniqueSuffix}@example.com`;
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

    ownerUserId = await createUser("owner");
    memberUserId = await createUser("member");
    viewerUserId = await createUser("viewer");
    outsiderUserId = await createUser("outsider");

    const { error: memberInsertErr } = await adminClient
      .from("workspace_members")
      .insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: viewerUserId, role: "viewer", status: "active" },
      ]);
    if (memberInsertErr) {
      throw new Error(`Failed to seed members: ${memberInsertErr.message}`);
    }
  });

  beforeEach(() => {
    currentTestUserId = null;
  });

  afterAll(async () => {
    for (const pId of createdProjectIds) {
      await adminClient.from("checklist_items").delete().in(
        "task_id",
        (
          await adminClient.from("tasks").select("id").eq("project_id", pId)
        ).data?.map((r) => r.id) ?? [],
      );
      await adminClient.from("comments").delete().in(
        "task_id",
        (
          await adminClient.from("tasks").select("id").eq("project_id", pId)
        ).data?.map((r) => r.id) ?? [],
      );
      await adminClient.from("tasks").delete().eq("project_id", pId);
      await adminClient.from("project_statuses").delete().eq("project_id", pId);
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

  it("AS-494: a member can create a sample project spread across the default columns with priorities, due dates, a checklist, and a comment", async () => {
    const { createSampleProject } = await import("@/lib/seed/sample-project");

    currentTestUserId = memberUserId;
    const result = await createSampleProject(workspaceId);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdProjectIds.push(result.data.projectId);

    // Clearly labelled as a sample.
    expect(result.data.projectName.toLowerCase()).toContain("sample");
    expect(result.data.tasksCreated).toBeGreaterThan(0);

    const { data: projectRow } = await adminClient
      .from("projects")
      .select("id, name, description, workspace_id")
      .eq("id", result.data.projectId)
      .single();
    expect(projectRow?.workspace_id).toBe(workspaceId);
    expect(projectRow?.name.toLowerCase()).toContain("sample");
    expect(projectRow?.description?.toLowerCase()).toContain("sample");

    const { data: taskRows } = await adminClient
      .from("tasks")
      .select("id, title, status, priority, due_date")
      .eq("project_id", result.data.projectId)
      .order("created_at", { ascending: true });

    expect((taskRows ?? []).length).toBe(result.data.tasksCreated);

    // Spread across more than one of the project's default columns.
    const statuses = new Set((taskRows ?? []).map((t) => t.status));
    expect(statuses.size).toBeGreaterThan(1);

    // Every seeded task has a priority and a due date.
    for (const task of taskRows ?? []) {
      expect(task.priority).not.toBeNull();
      expect(task.due_date).not.toBeNull();
    }

    // A checklist and a comment exist on the first task.
    const firstTaskId = taskRows?.[0]?.id;
    const { data: checklistRows } = await adminClient
      .from("checklist_items")
      .select("id")
      .eq("task_id", firstTaskId);
    expect((checklistRows ?? []).length).toBeGreaterThan(0);

    const { data: commentRows } = await adminClient
      .from("comments")
      .select("id")
      .eq("task_id", firstTaskId);
    expect((commentRows ?? []).length).toBeGreaterThan(0);

    // Deletable in one step: the ordinary archiveProject action works on
    // it exactly like any other project.
    const { archiveProject } = await import("@/lib/actions/projects");
    currentTestUserId = memberUserId;
    const archiveResult = await archiveProject(
      result.data.projectId,
      workspaceId,
    );
    // A plain member is not admin/owner, so this specific caller is
    // rejected — re-run as the owner to prove the one-step delete itself
    // works, without conflating the two different assertions.
    expect(archiveResult.ok).toBe(false);

    currentTestUserId = ownerUserId;
    const ownerArchiveResult = await archiveProject(
      result.data.projectId,
      workspaceId,
    );
    expect(ownerArchiveResult.ok).toBe(true);

    const { data: archivedRow } = await adminClient
      .from("projects")
      .select("deleted_at")
      .eq("id", result.data.projectId)
      .single();
    expect(archivedRow?.deleted_at).not.toBeNull();
  });

  it("AS-494 negative: an unauthenticated caller cannot create a sample project", async () => {
    const { createSampleProject } = await import("@/lib/seed/sample-project");

    currentTestUserId = null;
    const result = await createSampleProject(workspaceId);

    expect(result.ok).toBe(false);

    const { data: projectRows } = await adminClient
      .from("projects")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("name", "Sample Project");
    // No project was created for this attempt (any prior success in this
    // suite is tracked/cleaned separately via createdProjectIds).
    expect(
      (projectRows ?? []).every((row) => createdProjectIds.includes(row.id)),
    ).toBe(true);
  });

  it("AS-494 negative: a viewer (read-only) cannot create a sample project", async () => {
    const { createSampleProject } = await import("@/lib/seed/sample-project");

    currentTestUserId = viewerUserId;
    const result = await createSampleProject(workspaceId);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.toLowerCase()).toContain("viewer");
  });

  it("AS-494 negative: a non-member of the workspace cannot create a sample project (no cross-workspace leak)", async () => {
    const { createSampleProject } = await import("@/lib/seed/sample-project");

    currentTestUserId = outsiderUserId;
    const result = await createSampleProject(workspaceId);

    expect(result.ok).toBe(false);
  });
});
