// Integration tests for F229 (AS-429, AS-432, AS-433): saved-view UI —
// specifically the REAL read paths a worker's spec called out as needing
// end-to-end proof: opening a saved view's shareable URL as ANOTHER real
// member reproduces the same task list (AS-432); a member without project
// access, and a link to someone else's PERSONAL view, are both refused
// without confirming the view exists (AS-429/AS-434 boundary); and a view
// referencing a deleted status/removed member degrades gracefully instead
// of erroring (AS-433). Same currentTestClient-mock/signInAs/beforeAll-seed
// pattern as tests/integration/f228-saved-view-actions.test.ts — every
// case here drives the REAL createSavedView/getSavedView actions,
// listSavedViewsForProject/getMyDefaultSavedView queries, and
// getProjectListTasks against the real linked Supabase project.

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F229: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
};

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F229 saved-views UI read paths (AS-429, AS-432, AS-433)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectId: string;
    let todoStatusId: string;
    let inProgressStatusId: string;

    let ownerUserId: string;

    let memberAEmail: string; // owns the personal + shared views under test
    const memberAPassword = "Test-password-1!";
    let memberAUserId: string;

    let memberBEmail: string; // another real member with project access
    const memberBPassword = "Test-password-1!";
    let memberBUserId: string;

    let memberCEmail: string; // a workspace member with NO access to this
    // (private) project — used for the AS-429/AS-434 boundary test
    const memberCPassword = "Test-password-1!";
    let memberCUserId: string;

    let outsiderEmail: string; // not a member of the workspace at all
    const outsiderPassword = "Test-password-1!";

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    function signOut() {
      currentTestClient = {
        auth: { getUser: async () => ({ data: { user: null } }) },
        from: (() => {
          throw new Error("no client signed in for this test");
        }) as unknown as SupabaseClient["from"],
      };
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F229 Workspace", slug: `f229-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      async function createUser(label: string) {
        const email = `f229-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password: "Test-password-1!",
          email_confirm: true,
        });
        if (error || !data.user) {
          throw new Error(`Failed to create ${label} user: ${error?.message}`);
        }
        createdUserIds.push(data.user.id);
        return { id: data.user.id, email };
      }

      const owner = await createUser("owner");
      ownerUserId = owner.id;

      const memberA = await createUser("membera");
      memberAUserId = memberA.id;
      memberAEmail = memberA.email;

      const memberB = await createUser("memberb");
      memberBUserId = memberB.id;
      memberBEmail = memberB.email;

      const memberC = await createUser("memberc");
      memberCUserId = memberC.id;
      memberCEmail = memberC.email;

      const outsider = await createUser("outsider");
      outsiderEmail = outsider.email;

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberAUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: memberBUserId, role: "member", status: "active" },
        // memberC is an active WORKSPACE member but is deliberately left
        // off the project's member list below, so a PRIVATE project stays
        // invisible to them (AS-429's own "visible to every member with
        // ACCESS to its project" — not every workspace member).
        { workspace_id: workspaceId, user_id: memberCUserId, role: "member", status: "active" },
      ]);
      if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

      // A PRIVATE project so the AS-429/AS-434 boundary is meaningful:
      // memberC is a workspace member but not a project member, so
      // `is_project_visible_to` (and therefore a shared view's
      // visibility) must refuse them.
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F229 Project ${uniqueSuffix}`,
          created_by: ownerUserId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (projErr || !proj) throw new Error(`Failed to create project: ${projErr?.message}`);
      projectId = proj.id;
      createdProjectIds.push(projectId);

      const { error: projMemberErr } = await adminClient.from("project_members").insert([
        { project_id: projectId, user_id: memberAUserId },
        { project_id: projectId, user_id: memberBUserId },
      ]);
      if (projMemberErr) {
        throw new Error(`Failed to seed project members: ${projMemberErr.message}`);
      }

      // A project auto-seeds its default statuses on creation (F219) —
      // reuse those real columns rather than inserting duplicates.
      const { data: statuses, error: statusErr } = await adminClient
        .from("project_statuses")
        .select("id, name")
        .eq("project_id", projectId);
      if (statusErr || !statuses || statuses.length === 0) {
        throw new Error(`Failed to load seeded statuses: ${statusErr?.message}`);
      }
      todoStatusId = statuses.find((s) => s.name === "todo")?.id ?? statuses[0].id;
      inProgressStatusId =
        statuses.find((s) => s.name === "in_progress")?.id ?? statuses[1]?.id ?? statuses[0].id;

      const { error: taskErr } = await adminClient.from("tasks").insert([
        {
          project_id: projectId,
          title: "Todo task",
          status: "todo",
          status_id: todoStatusId,
          author_id: ownerUserId,
          number: 1,
        },
        {
          project_id: projectId,
          title: "In-progress task",
          status: "in_progress",
          status_id: inProgressStatusId,
          author_id: ownerUserId,
          number: 2,
        },
      ]);
      if (taskErr) throw new Error(`Failed to seed tasks: ${taskErr.message}`);
    });

    beforeEach(() => {
      signOut();
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("saved_views").delete().eq("project_id", pId);
        await adminClient.from("tasks").delete().eq("project_id", pId);
        await adminClient.from("project_members").delete().eq("project_id", pId);
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

    // ------------------------------------------------------------------
    // AS-432: a shareable URL (the viewId) reproduces the same result for
    // ANOTHER real member.
    // ------------------------------------------------------------------

    it("test_AS_432_opening_a_shared_views_url_as_another_member_reproduces_the_same_task_list", async () => {
      const { createSavedView, getSavedView } = await import("@/lib/actions/views");
      const { getProjectListTasks } = await import("@/lib/queries/tasks");
      const { resolveListViewFilters } = await import("@/lib/views/resolve-view");

      await signInAs(memberAEmail, memberAPassword);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Todo only",
        scope: "shared",
        viewType: "list",
        config: { filters: [{ field: "status", operator: "eq", value: "todo" }], sort: [], groupBy: null },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // memberA's own resolved result (the "creator's" view).
      const resolvedForA = resolveListViewFilters(created.data.config, {
        validStatusNames: new Set(["todo", "in_progress"]),
        validAssigneeIds: new Set(),
      });
      const tasksForA = await getProjectListTasks(projectId, resolvedForA.filters, resolvedForA.sort);

      // memberB opens the SAME url (viewId) as a DIFFERENT real member.
      await signInAs(memberBEmail, memberBPassword);
      const opened = await getSavedView(created.data.id);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;
      expect(opened.data.config).toEqual(created.data.config);

      const resolvedForB = resolveListViewFilters(opened.data.config, {
        validStatusNames: new Set(["todo", "in_progress"]),
        validAssigneeIds: new Set(),
      });
      const tasksForB = await getProjectListTasks(projectId, resolvedForB.filters, resolvedForB.sort);

      expect(tasksForB.map((t) => t.id).sort()).toEqual(tasksForA.map((t) => t.id).sort());
      expect(tasksForB.every((t) => t.status === "todo")).toBe(true);
      expect(tasksForB.length).toBeGreaterThan(0);
    });

    // ------------------------------------------------------------------
    // AS-429 / AS-434 boundary: refused without confirming existence.
    // ------------------------------------------------------------------

    it("test_AS_429_a_member_without_project_access_is_refused_a_shared_views_link_without_confirming_it_exists", async () => {
      const { createSavedView, getSavedView } = await import("@/lib/actions/views");
      await signInAs(memberAEmail, memberAPassword);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Shared, private project",
        scope: "shared",
        viewType: "list",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // memberC is an active WORKSPACE member but has no project_members
      // row on this PRIVATE project.
      await signInAs(memberCEmail, memberCPassword);
      const opened = await getSavedView(created.data.id);
      expect(opened.ok).toBe(false);
      if (opened.ok) return;
      // Generic "not found" message — never a distinct "forbidden"
      // message that would confirm the view exists.
      expect(opened.error).toMatch(/not found/i);
    });

    it("test_AS_434_a_link_to_someone_elses_personal_view_is_refused_without_confirming_it_exists", async () => {
      const { createSavedView, getSavedView } = await import("@/lib/actions/views");
      await signInAs(memberAEmail, memberAPassword);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "MemberA's personal view",
        scope: "personal",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // memberB DOES have access to the project itself, but this is a
      // PERSONAL view — access to the project is irrelevant.
      await signInAs(memberBEmail, memberBPassword);
      const opened = await getSavedView(created.data.id);
      expect(opened.ok).toBe(false);
      if (opened.ok) return;
      expect(opened.error).toMatch(/not found/i);
    });

    it("test_AS_429_an_outsider_with_no_workspace_membership_cannot_open_the_link_either", async () => {
      const { createSavedView, getSavedView } = await import("@/lib/actions/views");
      await signInAs(memberAEmail, memberAPassword);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Shared, outsider test",
        scope: "shared",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(outsiderEmail, outsiderPassword);
      const opened = await getSavedView(created.data.id);
      expect(opened.ok).toBe(false);
    });

    // ------------------------------------------------------------------
    // AS-433: dangling status / removed member degrade gracefully.
    // ------------------------------------------------------------------

    it("test_AS_433_a_view_referencing_a_since_deleted_status_still_opens_and_returns_tasks", async () => {
      const { createSavedView, getSavedView } = await import("@/lib/actions/views");
      const { getProjectListTasks } = await import("@/lib/queries/tasks");
      const { resolveListViewFilters } = await import("@/lib/views/resolve-view");

      await signInAs(memberAEmail, memberAPassword);

      // A throwaway status that this view will filter by, then gets
      // deleted out from under the view — the exact dangling-reference
      // class AS-433 names.
      const { data: staleStatus, error: staleStatusErr } = await adminClient
        .from("project_statuses")
        .insert({
          project_id: projectId,
          name: "will_be_deleted",
          position: 2,
          color: "#ff0000",
          category: "not_started",
        })
        .select("id, name")
        .single();
      if (staleStatusErr || !staleStatus) {
        throw new Error(`Failed to create stale status: ${staleStatusErr?.message}`);
      }

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Filtered by a status that will vanish",
        scope: "personal",
        config: {
          filters: [{ field: "status", operator: "eq", value: staleStatus.name }],
          sort: [],
          groupBy: null,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Delete the status column the view's filter names — reassign is
      // not required for this test since no task actually used it.
      const { error: deleteStatusErr } = await adminClient
        .from("project_statuses")
        .delete()
        .eq("id", staleStatus.id);
      expect(deleteStatusErr).toBeNull();

      const opened = await getSavedView(created.data.id);
      expect(opened.ok).toBe(true);
      if (!opened.ok) return;

      // The CURRENT set of real column names — the deleted one is gone.
      const { data: currentColumns } = await adminClient
        .from("project_statuses")
        .select("name")
        .eq("project_id", projectId);
      const validStatusNames = new Set((currentColumns ?? []).map((c) => c.name));
      expect(validStatusNames.has(staleStatus.name)).toBe(false);

      const resolved = resolveListViewFilters(opened.data.config, {
        validStatusNames,
        validAssigneeIds: new Set(),
      });
      // The dangling filter is dropped, not applied and not errored.
      expect(resolved.filters.status).toBeUndefined();
      expect(resolved.droppedCount).toBe(1);

      // The list query still succeeds and still returns this project's
      // (unfiltered, since the only filter was dropped) tasks — never an
      // error, never an empty result caused by filtering on a status that
      // can no longer match anything.
      const tasks = await getProjectListTasks(projectId, resolved.filters, resolved.sort);
      expect(tasks.length).toBeGreaterThan(0);
    });

    it("test_AS_433_a_view_referencing_a_removed_workspace_member_still_opens_and_returns_tasks", async () => {
      const { createSavedView, getSavedView } = await import("@/lib/actions/views");
      const { getProjectListTasks } = await import("@/lib/queries/tasks");
      const { resolveListViewFilters } = await import("@/lib/views/resolve-view");

      await signInAs(memberAEmail, memberAPassword);

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Filtered by memberB, who will be removed",
        scope: "personal",
        config: {
          filters: [{ field: "assigneeId", operator: "eq", value: memberBUserId }],
          sort: [],
          groupBy: null,
        },
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // Remove memberB from the workspace — this codebase's real
      // removeMember action hard-deletes the workspace_members row (see
      // lib/actions/workspaces.ts's `remove_workspace_member` RPC), so
      // this mirrors that real end state rather than a status flag that
      // doesn't exist on this table.
      const { error: removeErr } = await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("user_id", memberBUserId);
      expect(removeErr).toBeNull();

      try {
        const opened = await getSavedView(created.data.id);
        expect(opened.ok).toBe(true);
        if (!opened.ok) return;

        // The page's own "currently active member" set no longer
        // includes memberB.
        const { data: activeMembers } = await adminClient
          .from("workspace_members")
          .select("user_id")
          .eq("workspace_id", workspaceId)
          .eq("status", "active");
        const validAssigneeIds = new Set((activeMembers ?? []).map((m) => m.user_id));
        expect(validAssigneeIds.has(memberBUserId)).toBe(false);

        const resolved = resolveListViewFilters(opened.data.config, {
          validStatusNames: new Set(),
          validAssigneeIds,
        });
        expect(resolved.filters.assigneeId).toBeUndefined();
        expect(resolved.droppedCount).toBe(1);

        const tasks = await getProjectListTasks(projectId, resolved.filters, resolved.sort);
        expect(tasks.length).toBeGreaterThan(0);
      } finally {
        // Restore for any later test's assumptions (memberB is reused as
        // a real active member in later cases in this file).
        await adminClient.from("workspace_members").insert({
          workspace_id: workspaceId,
          user_id: memberBUserId,
          role: "member",
          status: "active",
        });
      }
    });

    // ------------------------------------------------------------------
    // AS-431 (read side): the default view auto-applies.
    // ------------------------------------------------------------------

    it("test_AS_431_getMyDefaultSavedView_resolves_the_callers_own_default_for_this_project", async () => {
      const { createSavedView, setDefaultSavedView } = await import("@/lib/actions/views");
      const { getMyDefaultSavedView } = await import("@/lib/queries/views");

      await signInAs(memberAEmail, memberAPassword);

      const none = await getMyDefaultSavedView(projectId, "list");
      expect(none).toBeNull();

      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "My default",
        scope: "personal",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const setDefault = await setDefaultSavedView(created.data.id);
      expect(setDefault.ok).toBe(true);

      const resolved = await getMyDefaultSavedView(projectId, "list");
      expect(resolved?.id).toBe(created.data.id);

      // memberB has never set a default of their own — resolves to null,
      // never memberA's.
      await signInAs(memberBEmail, memberBPassword);
      const forB = await getMyDefaultSavedView(projectId, "list");
      expect(forB).toBeNull();
    });

    it("test_AS_429_listSavedViewsForProject_includes_shared_views_from_other_members", async () => {
      const { createSavedView } = await import("@/lib/actions/views");
      const { listSavedViewsForProject } = await import("@/lib/queries/views");

      await signInAs(memberAEmail, memberAPassword);
      const created = await createSavedView({
        workspaceId,
        projectId,
        name: "Visible to memberB too",
        scope: "shared",
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await signInAs(memberBEmail, memberBPassword);
      const list = await listSavedViewsForProject(projectId, "list");
      const found = list.find((v) => v.id === created.data.id);
      expect(found).toBeDefined();
      expect(found?.isMine).toBe(false);
    });
  },
);
