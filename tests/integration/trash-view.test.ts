// Integration test for F188 (AS-343, AS-347, AS-352), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf/signed-in-client
// pattern established by tests/integration/board-tasks-completion.test.ts
// (F154) and tests/integration/delete-task.test.ts (F038).
//
// `@/lib/supabase/server`'s `createClient()` is mocked to return a real,
// signed-in supabase-js client for whichever test user is "currently
// signed in" at call time — this lets the SAME mock back both the real
// Server Actions under test (deleteTask, deleteComment — they call
// `supabase.auth.getUser()`) and `getWorkspaceTrash` (it needs the full
// RLS-respecting client, not just a fake `{ auth: { getUser } }` stub),
// so AS-352's actual RLS enforcement is exercised end to end rather than
// asserted against a hand-rolled admin-client re-query.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentClient: SupabaseClient | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

describe.skipIf(!haveAdminCreds)(
  "trash view (F188: AS-343, AS-347, AS-352)",
  () => {
    let adminClient: SupabaseClient;

    const createdTaskIds: string[] = [];
    const createdCommentIds: string[] = [];
    const createdProjectIds: string[] = [];
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    let workspaceAId: string;
    let workspaceBId: string;
    let visibleProjectId: string;
    let privateProjectId: string;

    let memberAEmail: string;
    let memberAPassword: string;
    let memberAId: string; // owner of workspace A, explicit member of the private project

    let memberA2Email: string;
    let memberA2Password: string;
    let memberA2Id: string; // plain member of workspace A, NOT a member of the private project

    let memberBEmail: string;
    let memberBPassword: string;
    let memberBId: string; // sole member of a different workspace entirely

    async function signInAs(
      email: string,
      password: string,
    ): Promise<SupabaseClient> {
      const client = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
      return client;
    }

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F188 Workspace A", slug: `f188-a-${suffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;
      createdWorkspaceIds.push(workspaceAId);

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F188 Workspace B", slug: `f188-b-${suffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;
      createdWorkspaceIds.push(workspaceBId);

      memberAEmail = `f188-member-a-${suffix}@example.com`;
      memberAPassword = "Test-password-1!";
      const { data: aAuth, error: aAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberAEmail,
          password: memberAPassword,
          email_confirm: true,
        });
      if (aAuthErr || !aAuth.user) throw new Error(`Failed to create member A: ${aAuthErr?.message}`);
      memberAId = aAuth.user.id;
      createdUserIds.push(memberAId);

      memberA2Email = `f188-member-a2-${suffix}@example.com`;
      memberA2Password = "Test-password-1!";
      const { data: a2Auth, error: a2AuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberA2Email,
          password: memberA2Password,
          email_confirm: true,
        });
      if (a2AuthErr || !a2Auth.user) throw new Error(`Failed to create member A2: ${a2AuthErr?.message}`);
      memberA2Id = a2Auth.user.id;
      createdUserIds.push(memberA2Id);

      memberBEmail = `f188-member-b-${suffix}@example.com`;
      memberBPassword = "Test-password-1!";
      const { data: bAuth, error: bAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberBEmail,
          password: memberBPassword,
          email_confirm: true,
        });
      if (bAuthErr || !bAuth.user) throw new Error(`Failed to create member B: ${bAuthErr?.message}`);
      memberBId = bAuth.user.id;
      createdUserIds.push(memberBId);

      const { error: memberInsertErr } = await adminClient
        .from("workspace_members")
        .insert([
          { workspace_id: workspaceAId, user_id: memberAId, role: "owner", status: "active" },
          { workspace_id: workspaceAId, user_id: memberA2Id, role: "member", status: "active" },
          { workspace_id: workspaceBId, user_id: memberBId, role: "owner", status: "active" },
        ]);
      if (memberInsertErr) throw new Error(`Failed to seed memberships: ${memberInsertErr.message}`);

      const randomKeySuffix = () =>
        Array.from({ length: 4 }, () =>
          "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(Math.random() * 26)],
        ).join("");

      const { data: visibleProject, error: visibleErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceAId,
          name: `F188 Visible Project ${suffix}`,
          key: `V${randomKeySuffix()}`,
          created_by: memberAId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (visibleErr || !visibleProject) throw new Error(`Failed to create visible project: ${visibleErr?.message}`);
      visibleProjectId = visibleProject.id;
      createdProjectIds.push(visibleProjectId);

      const { data: privateProject, error: privateErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceAId,
          name: `F188 Private Project ${suffix}`,
          key: `P${randomKeySuffix()}`,
          created_by: memberAId,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateErr || !privateProject) throw new Error(`Failed to create private project: ${privateErr?.message}`);
      privateProjectId = privateProject.id;
      createdProjectIds.push(privateProjectId);

      // memberA is an explicit project_members row on the private
      // project (so they can see its trash); memberA2 deliberately is
      // NOT — the negative case for AS-352's private-project rule.
      const { error: pmErr } = await adminClient
        .from("project_members")
        .insert({ project_id: privateProjectId, user_id: memberAId, project_role: "lead" });
      if (pmErr) throw new Error(`Failed to seed project_members: ${pmErr.message}`);
    });

    afterAll(async () => {
      if (createdCommentIds.length > 0) {
        await adminClient.from("comments").delete().in("id", createdCommentIds);
      }
      if (createdTaskIds.length > 0) {
        await adminClient.from("tasks").delete().in("id", createdTaskIds);
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

    async function makeTask(projectId: string, title: string): Promise<string> {
      const { data, error } = await adminClient
        .from("tasks")
        .insert({ project_id: projectId, title, author_id: memberAId })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Failed to seed task: ${error?.message}`);
      createdTaskIds.push(data.id);
      return data.id;
    }

    async function makeComment(taskId: string, text: string): Promise<string> {
      const { data, error } = await adminClient
        .from("comments")
        .insert({ task_id: taskId, user_id: memberAId, text })
        .select("id")
        .single();
      if (error || !data) throw new Error(`Failed to seed comment: ${error?.message}`);
      createdCommentIds.push(data.id);
      return data.id;
    }

    it("test_AS_343_a_deleted_task_lands_in_the_trash_query_end_to_end", async () => {
      const taskId = await makeTask(visibleProjectId, `F188 AS-343 Task ${Date.now()}`);

      currentClient = await signInAs(memberAEmail, memberAPassword);
      const { deleteTask } = await import("@/lib/actions/tasks");
      const result = await deleteTask(taskId);
      expect(result.ok).toBe(true);

      const { getWorkspaceTrash } = await import("@/lib/queries/trash");
      const trash = await getWorkspaceTrash(workspaceAId);

      const entry = trash.find((item) => item.id === taskId && item.type === "task");
      expect(entry).toBeTruthy();
    });

    it("test_AS_347_trash_shows_the_correct_what_who_and_when_for_a_deleted_task", async () => {
      const title = `F188 AS-347 Task ${Date.now()}`;
      const taskId = await makeTask(visibleProjectId, title);

      currentClient = await signInAs(memberA2Email, memberA2Password);
      const { deleteTask } = await import("@/lib/actions/tasks");
      const beforeDelete = Date.now();
      const result = await deleteTask(taskId);
      expect(result.ok).toBe(true);

      const { getWorkspaceTrash } = await import("@/lib/queries/trash");
      const trash = await getWorkspaceTrash(workspaceAId);
      const entry = trash.find((item) => item.id === taskId && item.type === "task");

      expect(entry).toBeTruthy();
      // "What": the exact task title, not a placeholder.
      expect(entry?.label).toBe(title);
      // "When": a real, recent timestamp — not null, not stale.
      expect(entry?.deletedAt).toBeTruthy();
      expect(new Date(entry!.deletedAt).getTime()).toBeGreaterThanOrEqual(
        beforeDelete - 5000,
      );
      // "By whom": resolves to the ACTUAL deleter (memberA2), not the
      // task's original author (memberA) and not null.
      expect(entry?.deletedByName).toBeTruthy();
      expect(entry?.deletedByName).not.toBe(null);
      const { data: deleterRow } = await adminClient
        .from("tasks")
        .select("deleted_by")
        .eq("id", taskId)
        .single();
      expect(deleterRow?.deleted_by).toBe(memberA2Id);
    });

    it("test_AS_347_trash_shows_the_correct_what_who_and_when_for_a_deleted_comment", async () => {
      const taskId = await makeTask(visibleProjectId, `F188 comment host ${Date.now()}`);
      const commentText = `F188 AS-347 comment body ${Date.now()}`;
      const commentId = await makeComment(taskId, commentText);

      currentClient = await signInAs(memberAEmail, memberAPassword);
      const { deleteComment } = await import("@/lib/actions/comments");
      const result = await deleteComment(commentId);
      expect(result.ok).toBe(true);

      const { getWorkspaceTrash } = await import("@/lib/queries/trash");
      const trash = await getWorkspaceTrash(workspaceAId);
      const entry = trash.find((item) => item.id === commentId && item.type === "comment");

      expect(entry).toBeTruthy();
      expect(entry?.label).toBe(commentText);
      expect(entry?.deletedAt).toBeTruthy();
      expect(entry?.deletedByName).toBeTruthy();
    });

    it("test_AS_352_a_user_in_one_workspace_cannot_see_another_workspaces_trash", async () => {
      const taskId = await makeTask(visibleProjectId, `F188 AS-352 cross-workspace ${Date.now()}`);

      currentClient = await signInAs(memberAEmail, memberAPassword);
      const { deleteTask } = await import("@/lib/actions/tasks");
      const result = await deleteTask(taskId);
      expect(result.ok).toBe(true);

      // memberB is not a member of workspace A at all.
      currentClient = await signInAs(memberBEmail, memberBPassword);
      const { getWorkspaceTrash } = await import("@/lib/queries/trash");
      const trashAsSeenByB = await getWorkspaceTrash(workspaceAId);

      expect(trashAsSeenByB.find((item) => item.id === taskId)).toBeUndefined();
    });

    it("test_AS_352_a_workspace_member_without_private_project_access_cannot_see_that_projects_deleted_tasks", async () => {
      const taskId = await makeTask(privateProjectId, `F188 AS-352 private ${Date.now()}`);

      currentClient = await signInAs(memberAEmail, memberAPassword);
      const { deleteTask } = await import("@/lib/actions/tasks");
      const result = await deleteTask(taskId);
      expect(result.ok).toBe(true);

      // memberA2 is an active member of workspace A (same workspace) but
      // has no project_members row for the private project — exactly the
      // negative case this feature's Notes call out ("a private
      // project's deleted tasks aren't visible to a non-member just
      // because they're in trash").
      currentClient = await signInAs(memberA2Email, memberA2Password);
      const { getWorkspaceTrash } = await import("@/lib/queries/trash");
      const trashAsSeenByA2 = await getWorkspaceTrash(workspaceAId);

      expect(trashAsSeenByA2.find((item) => item.id === taskId)).toBeUndefined();

      // Sanity check the row genuinely exists and is deleted (proves the
      // absence above is an RLS/visibility outcome, not a seeding bug).
      const { data: row } = await adminClient
        .from("tasks")
        .select("id, deleted_at")
        .eq("id", taskId)
        .single();
      expect(row?.deleted_at).toBeTruthy();

      // Positive control: memberA (an explicit project_members row on
      // the private project) DOES see it.
      currentClient = await signInAs(memberAEmail, memberAPassword);
      const trashAsSeenByA = await getWorkspaceTrash(workspaceAId);
      expect(trashAsSeenByA.find((item) => item.id === taskId)).toBeTruthy();
    });
  },
);
