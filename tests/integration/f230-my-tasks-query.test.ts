// Integration test for F230 My Tasks (AS-435, AS-436, AS-439), run against
// the real linked Supabase project -- mirrors the loadDotEnv/real-signed-
// in-client/beforeAll-seed/afterAll-teardown pattern established by
// tests/integration/f223-status-integration-list-search-dashboard.test.ts
// and tests/integration/f322-single-task-project-visibility.test.ts.
//
// Drives the REAL query path (getMyTasks, lib/queries/my-tasks.ts) through
// the plain RLS-scoped session client (never a raw admin/RLS-bypassing
// query) — exactly the layer F322/F323's bug class slipped through when it
// wasn't exercised, per this feature's spec instruction.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F230: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestClient: {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null } }> };
  from: SupabaseClient["from"];
  rpc: SupabaseClient["rpc"];
} = {
  auth: { getUser: async () => ({ data: { user: null } }) },
  from: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["from"],
  rpc: (() => {
    throw new Error("no client signed in for this test");
  }) as unknown as SupabaseClient["rpc"],
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentTestClient,
}));

describe.skipIf(!haveAdminCreds)(
  "F230 My Tasks getMyTasks (AS-435, AS-436, AS-439)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let visibleProjectId: string;
    let visibleProjectKey: string;
    let privateProjectId: string;
    let archivedProjectId: string;

    let memberEmail: string;
    const memberPassword = "Test-password-1!";
    let memberUserId: string;
    let otherMemberUserId: string;

    let assignedVisibleTaskId: string;
    let assignedPrivateTaskId: string;
    let multiAssigneeTaskId: string;
    let customDoneTaskId: string;
    let archivedProjectTaskId: string;
    let trashedTaskId: string;

    async function signInAs(email: string, password: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      currentTestClient = client as unknown as typeof currentTestClient;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F230 Workspace", slug: `f230-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to seed workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberEmail = `f230-member-${uniqueSuffix}@example.com`;
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;
      createdUserIds.push(memberUserId);

      const { data: otherAuth, error: otherAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f230-other-${uniqueSuffix}@example.com`,
          password: memberPassword,
          email_confirm: true,
        });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other member: ${otherAuthErr?.message}`);
      }
      otherMemberUserId = otherAuth.user.id;
      createdUserIds.push(otherMemberUserId);

      const { error: memberRowErr } = await adminClient
        .from("workspace_members")
        .insert([
          { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
          { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
        ]);
      if (memberRowErr) {
        throw new Error(`Failed to seed membership: ${memberRowErr.message}`);
      }

      // Visible project: workspace-visible, member has no explicit
      // project_members row but sees it via visibility='workspace'.
      const { data: visibleProject, error: visibleErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F230 Visible Project",
          visibility: "workspace",
        })
        .select("id, key")
        .single();
      if (visibleErr || !visibleProject) {
        throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
      }
      visibleProjectId = visibleProject.id;
      visibleProjectKey = visibleProject.key;
      createdProjectIds.push(visibleProjectId);

      // Private project: the member is NOT an explicit project_members row
      // -- must be entirely invisible through getMyTasks.
      const { data: privateProject, error: privateErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F230 Private Project",
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateErr || !privateProject) {
        throw new Error(`Failed to seed private project: ${privateErr?.message}`);
      }
      privateProjectId = privateProject.id;
      createdProjectIds.push(privateProjectId);

      // Archived project: workspace-visible but soft-deleted -- must be
      // excluded from My Tasks regardless of visibility.
      const { data: archivedProject, error: archivedErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F230 Archived Project",
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (archivedErr || !archivedProject) {
        throw new Error(`Failed to seed archived project: ${archivedErr?.message}`);
      }
      archivedProjectId = archivedProject.id;
      createdProjectIds.push(archivedProjectId);

      // Give the private project's OTHER member an explicit membership row
      // (irrelevant to `memberUserId`, just realistic seed data).
      await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: otherMemberUserId,
      });

      // Seed a task in the visible project, assigned to memberUserId.
      const { data: visibleTask, error: visibleTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F230 visible assigned task",
          status: "todo",
          priority: "high",
          author_id: memberUserId,
          due_date: "2020-01-01", // deliberately far in the past -> overdue
          number: 1,
        })
        .select("id")
        .single();
      if (visibleTaskErr || !visibleTask) {
        throw new Error(`Failed to seed visible task: ${visibleTaskErr?.message}`);
      }
      assignedVisibleTaskId = visibleTask.id;
      await adminClient
        .from("task_assignees")
        .insert({ task_id: assignedVisibleTaskId, user_id: memberUserId });

      // Seed a task in the PRIVATE project, assigned to memberUserId --
      // must NOT appear for memberUserId (AS-435 negative / F322 bug
      // class).
      const { data: privateTask, error: privateTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F230 private assigned task",
          status: "todo",
          priority: "urgent",
          author_id: otherMemberUserId,
          number: 1,
        })
        .select("id")
        .single();
      if (privateTaskErr || !privateTask) {
        throw new Error(`Failed to seed private task: ${privateTaskErr?.message}`);
      }
      assignedPrivateTaskId = privateTask.id;
      await adminClient
        .from("task_assignees")
        .insert({ task_id: assignedPrivateTaskId, user_id: memberUserId });

      // Seed a MULTI-ASSIGNEE task in the visible project -- must appear
      // exactly once, not once per assignee.
      const { data: multiTask, error: multiTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F230 multi-assignee task",
          status: "todo",
          priority: "medium",
          author_id: memberUserId,
          number: 2,
        })
        .select("id")
        .single();
      if (multiTaskErr || !multiTask) {
        throw new Error(`Failed to seed multi-assignee task: ${multiTaskErr?.message}`);
      }
      multiAssigneeTaskId = multiTask.id;
      await adminClient.from("task_assignees").insert([
        { task_id: multiAssigneeTaskId, user_id: memberUserId },
        { task_id: multiAssigneeTaskId, user_id: otherMemberUserId },
      ]);

      // Seed a task on a CUSTOM/renamed done-category column in the
      // visible project -- getMyTasks must treat it as done via category,
      // never via a literal 'done' string comparison.
      const { data: doneCol, error: doneColErr } = await adminClient
        .from("project_statuses")
        .select("id")
        .eq("project_id", visibleProjectId)
        .eq("category", "done")
        .single();
      if (doneColErr || !doneCol) {
        throw new Error(`Failed to find seeded done column: ${doneColErr?.message}`);
      }
      const { error: renameDoneErr } = await adminClient
        .from("project_statuses")
        .update({ name: "Shipped ✅" })
        .eq("id", doneCol.id);
      if (renameDoneErr) throw new Error(renameDoneErr.message);

      const { data: doneTask, error: doneTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F230 custom-done-column task",
          status: "Shipped ✅",
          status_id: doneCol.id,
          priority: "low",
          author_id: memberUserId,
          number: 3,
        })
        .select("id")
        .single();
      if (doneTaskErr || !doneTask) {
        throw new Error(`Failed to seed custom-done task: ${doneTaskErr?.message}`);
      }
      customDoneTaskId = doneTask.id;
      await adminClient
        .from("task_assignees")
        .insert({ task_id: customDoneTaskId, user_id: memberUserId });

      // Seed a task in the ARCHIVED project, assigned to memberUserId --
      // must be excluded.
      const { data: archivedTask, error: archivedTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: archivedProjectId,
          title: "F230 archived-project task",
          status: "todo",
          priority: "low",
          author_id: memberUserId,
          number: 1,
        })
        .select("id")
        .single();
      if (archivedTaskErr || !archivedTask) {
        throw new Error(`Failed to seed archived-project task: ${archivedTaskErr?.message}`);
      }
      archivedProjectTaskId = archivedTask.id;
      await adminClient
        .from("task_assignees")
        .insert({ task_id: archivedProjectTaskId, user_id: memberUserId });
      const { error: archiveErr } = await adminClient
        .from("projects")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", archivedProjectId);
      if (archiveErr) throw new Error(archiveErr.message);

      // Seed a TRASHED task in the visible project, assigned to
      // memberUserId -- must be excluded.
      const { data: trashedTask, error: trashedTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: visibleProjectId,
          title: "F230 trashed task",
          status: "todo",
          priority: "low",
          author_id: memberUserId,
          number: 4,
        })
        .select("id")
        .single();
      if (trashedTaskErr || !trashedTask) {
        throw new Error(`Failed to seed trashed task: ${trashedTaskErr?.message}`);
      }
      trashedTaskId = trashedTask.id;
      await adminClient
        .from("task_assignees")
        .insert({ task_id: trashedTaskId, user_id: memberUserId });
      const { error: trashErr } = await adminClient
        .from("tasks")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", trashedTaskId);
      if (trashErr) throw new Error(trashErr.message);

      void visibleProjectKey;

      await signInAs(memberEmail, memberPassword);
    });

    afterAll(async () => {
      for (const id of createdProjectIds) {
        await adminClient.from("tasks").delete().eq("project_id", id);
        await adminClient.from("project_statuses").delete().eq("project_id", id);
        await adminClient.from("project_members").delete().eq("project_id", id);
        await adminClient.from("projects").delete().eq("id", id);
      }
      for (const id of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id);
      }
    });

    it("test_AS_435_lists_a_task_assigned_to_the_caller_in_a_project_they_can_see", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const allRows = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const ids = allRows.map((r) => r.id);
      expect(ids).toContain(assignedVisibleTaskId);
    });

    it("test_AS_435_negative_excludes_a_task_assigned_to_the_caller_in_a_private_project_they_cannot_see", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const allRows = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const ids = allRows.map((r) => r.id);
      expect(ids).not.toContain(assignedPrivateTaskId);
    });

    it("test_AS_435_a_multi_assignee_task_appears_exactly_once", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const allRows = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const matches = allRows.filter((r) => r.id === multiAssigneeTaskId);
      expect(matches.length).toBe(1);
    });

    it("test_AS_435_a_task_in_a_custom_renamed_done_category_column_is_marked_done_via_category_not_literal_text", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const allRows = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const row = allRows.find((r) => r.id === customDoneTaskId);
      expect(row).toBeDefined();
      expect(row?.statusCategory).toBe("done");
      expect(row?.isDone).toBe(true);
    });

    it("test_AS_435_negative_excludes_tasks_in_archived_projects", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const allRows = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const ids = allRows.map((r) => r.id);
      expect(ids).not.toContain(archivedProjectTaskId);
    });

    it("test_AS_435_negative_excludes_trashed_tasks", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const allRows = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const ids = allRows.map((r) => r.id);
      expect(ids).not.toContain(trashedTaskId);
    });

    it("test_AS_436_a_task_far_in_the_past_is_bucketed_as_overdue", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const ids = buckets.overdue.map((r) => r.id);
      expect(ids).toContain(assignedVisibleTaskId);
    });

    it("test_AS_439_each_returned_task_shows_its_project_name", async () => {
      const { getMyTasks } = await import("@/lib/queries/my-tasks");
      const buckets = await getMyTasks(workspaceId, memberUserId, "UTC");
      const allRows = [...buckets.overdue, ...buckets.today, ...buckets.thisWeek, ...buckets.later];
      const row = allRows.find((r) => r.id === assignedVisibleTaskId);
      expect(row?.projectName).toBe("F230 Visible Project");
      expect(row?.projectId).toBe(visibleProjectId);
    });
  },
);
