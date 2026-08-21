// Integration test for F132 (project visibility RLS: AS-226, AS-227,
// AS-228, AS-229), run against the real linked Supabase project.
//
// Sets up one workspace with three active members:
//   - ownerUser  (role: owner)
//   - memberUser (role: member) — a project member of the PRIVATE project
//   - outsiderUser (role: member) — NOT a project member of the private
//     project, but IS an active member of the same workspace
// and two projects: one 'workspace'-visible, one 'private'.
//
// Proves:
//   AS-226: the private project's rows (project, task, comment,
//     attachment, time_entry, checklist_items, task_dependencies) ARE
//     visible to ownerUser (workspace owner) and memberUser (explicit
//     project member), and NOT visible to outsiderUser.
//   AS-227: the workspace-visible project's rows ARE visible to
//     outsiderUser too, with no explicit project_members row required —
//     proving unchanged, existing workspace-wide access.
//   AS-228: outsiderUser's direct query for the private project returns
//     zero rows, not an error.
//   AS-229: only an owner/admin can change a project's visibility; a plain
//     member's attempt is rejected at the database level and the value is
//     unchanged.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "project visibility RLS — private vs workspace-wide (F132)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let ownerUserId: string;
    let memberUserId: string;
    let outsiderUserId: string;
    let ownerEmail: string;
    let memberEmail: string;
    let outsiderEmail: string;
    const password = "Test-password-1!";
    let ownerClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let outsiderClient: SupabaseClient;

    let privateProjectId: string;
    let privateTaskId: string;
    let privateCommentId: string;
    let privateAttachmentId: string;
    let privateTimeEntryId: string;
    let privateChecklistItemId: string;
    let privateDependentTaskId: string;

    let workspaceProjectId: string;
    let workspaceTaskId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F132 RLS workspace", slug: `f132-rls-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      async function createUser(label: string) {
        const email = `f132-${label}-${uniqueSuffix}@example.com`;
        const { data, error } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (error || !data.user) throw new Error(`Failed to create ${label}: ${error?.message}`);
        return { email, userId: data.user.id };
      }

      const owner = await createUser("owner");
      ownerEmail = owner.email;
      ownerUserId = owner.userId;

      const member = await createUser("member");
      memberEmail = member.email;
      memberUserId = member.userId;

      const outsider = await createUser("outsider");
      outsiderEmail = outsider.email;
      outsiderUserId = outsider.userId;

      const { error: membersErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
        { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: outsiderUserId, role: "member", status: "active" },
      ]);
      if (membersErr) throw new Error(`Failed to seed workspace members: ${membersErr.message}`);

      // Private project, with memberUser as its only explicit project member.
      const { data: privProj, error: privProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F132 private project",
          visibility: "private",
        })
        .select("id")
        .single();
      if (privProjErr || !privProj)
        throw new Error(`Failed to seed private project: ${privProjErr?.message}`);
      privateProjectId = privProj.id;

      const { error: pmErr } = await adminClient.from("project_members").insert({
        project_id: privateProjectId,
        user_id: memberUserId,
        project_role: "member",
      });
      if (pmErr) throw new Error(`Failed to seed project_members row: ${pmErr.message}`);

      const { data: privTask, error: privTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F132 private task",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (privTaskErr || !privTask)
        throw new Error(`Failed to seed private task: ${privTaskErr?.message}`);
      privateTaskId = privTask.id;

      const { data: privDepTask, error: privDepTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: "F132 private dependent task",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (privDepTaskErr || !privDepTask)
        throw new Error(`Failed to seed private dependent task: ${privDepTaskErr?.message}`);
      privateDependentTaskId = privDepTask.id;

      const { error: depErr } = await adminClient.from("task_dependencies").insert({
        blocking_task_id: privateTaskId,
        blocked_task_id: privateDependentTaskId,
        created_by: memberUserId,
      });
      if (depErr) throw new Error(`Failed to seed task_dependencies row: ${depErr.message}`);

      const { data: privComment, error: privCommentErr } = await adminClient
        .from("comments")
        .insert({ task_id: privateTaskId, user_id: memberUserId, text: "F132 private comment" })
        .select("id")
        .single();
      if (privCommentErr || !privComment)
        throw new Error(`Failed to seed private comment: ${privCommentErr?.message}`);
      privateCommentId = privComment.id;

      const { data: privAttachment, error: privAttachmentErr } = await adminClient
        .from("attachments")
        .insert({
          task_id: privateTaskId,
          file_url: `${privateTaskId}/f132-private-file.txt`,
          file_name: "f132-private-file.txt",
          uploaded_by: memberUserId,
        })
        .select("id")
        .single();
      if (privAttachmentErr || !privAttachment)
        throw new Error(`Failed to seed private attachment: ${privAttachmentErr?.message}`);
      privateAttachmentId = privAttachment.id;

      const { data: privTimeEntry, error: privTimeEntryErr } = await adminClient
        .from("time_entries")
        .insert({ task_id: privateTaskId, user_id: memberUserId, minutes: 30 })
        .select("id")
        .single();
      if (privTimeEntryErr || !privTimeEntry)
        throw new Error(`Failed to seed private time entry: ${privTimeEntryErr?.message}`);
      privateTimeEntryId = privTimeEntry.id;

      const { data: privChecklistItem, error: privChecklistItemErr } = await adminClient
        .from("checklist_items")
        .insert({ task_id: privateTaskId, content: "F132 private checklist item" })
        .select("id")
        .single();
      if (privChecklistItemErr || !privChecklistItem)
        throw new Error(`Failed to seed checklist item: ${privChecklistItemErr?.message}`);
      privateChecklistItemId = privChecklistItem.id;

      // Workspace-wide project — no project_members row for anyone.
      const { data: wsProj, error: wsProjErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F132 workspace-wide project",
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (wsProjErr || !wsProj)
        throw new Error(`Failed to seed workspace-wide project: ${wsProjErr?.message}`);
      workspaceProjectId = wsProj.id;

      const { data: wsTask, error: wsTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: workspaceProjectId,
          title: "F132 workspace-wide task",
          author_id: ownerUserId,
        })
        .select("id")
        .single();
      if (wsTaskErr || !wsTask)
        throw new Error(`Failed to seed workspace-wide task: ${wsTaskErr?.message}`);
      workspaceTaskId = wsTask.id;

      async function signIn(email: string) {
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) throw new Error(`Failed to sign in ${email}: ${error.message}`);
        return client;
      }

      ownerClient = await signIn(ownerEmail);
      memberClient = await signIn(memberEmail);
      outsiderClient = await signIn(outsiderEmail);
    });

    afterAll(async () => {
      if (privateTaskId || privateDependentTaskId) {
        await adminClient
          .from("task_dependencies")
          .delete()
          .eq("blocking_task_id", privateTaskId);
        await adminClient.from("checklist_items").delete().eq("task_id", privateTaskId);
        await adminClient.from("time_entries").delete().eq("task_id", privateTaskId);
        await adminClient.from("attachments").delete().eq("task_id", privateTaskId);
        await adminClient.from("comments").delete().eq("task_id", privateTaskId);
        await adminClient.from("tasks").delete().eq("id", privateTaskId);
        await adminClient.from("tasks").delete().eq("id", privateDependentTaskId);
      }
      if (workspaceTaskId) {
        await adminClient.from("tasks").delete().eq("id", workspaceTaskId);
      }
      if (privateProjectId) {
        await adminClient.from("project_members").delete().eq("project_id", privateProjectId);
        await adminClient.from("projects").delete().eq("id", privateProjectId);
      }
      if (workspaceProjectId) {
        await adminClient.from("projects").delete().eq("id", workspaceProjectId);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const userId of [ownerUserId, memberUserId, outsiderUserId]) {
        if (userId) await adminClient.auth.admin.deleteUser(userId);
      }
    });

    // ---------------------------------------------------------------
    // AS-226 / AS-228: private project visibility
    // ---------------------------------------------------------------

    it("AS-226: a workspace owner (not an explicit project member) CAN see a private project", async () => {
      const { data, error } = await ownerClient
        .from("projects")
        .select("id")
        .eq("id", privateProjectId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("AS-226: an explicit project member CAN see the private project and its rows", async () => {
      const { data: proj } = await memberClient
        .from("projects")
        .select("id")
        .eq("id", privateProjectId);
      expect(proj).toHaveLength(1);

      const { data: task } = await memberClient
        .from("tasks")
        .select("id")
        .eq("id", privateTaskId);
      expect(task).toHaveLength(1);

      const { data: comment } = await memberClient
        .from("comments")
        .select("id")
        .eq("id", privateCommentId);
      expect(comment).toHaveLength(1);

      const { data: attachment } = await memberClient
        .from("attachments")
        .select("id")
        .eq("id", privateAttachmentId);
      expect(attachment).toHaveLength(1);

      const { data: timeEntry } = await memberClient
        .from("time_entries")
        .select("id")
        .eq("id", privateTimeEntryId);
      expect(timeEntry).toHaveLength(1);

      const { data: checklistItem } = await memberClient
        .from("checklist_items")
        .select("id")
        .eq("id", privateChecklistItemId);
      expect(checklistItem).toHaveLength(1);

      const { data: dependency } = await memberClient
        .from("task_dependencies")
        .select("id")
        .eq("blocking_task_id", privateTaskId);
      expect(dependency).toHaveLength(1);
    });

    it("AS-226/AS-228: a workspace member who is NOT an explicit project member CANNOT see the private project (zero rows, not an error)", async () => {
      const { data, error } = await outsiderClient
        .from("projects")
        .select("id")
        .eq("id", privateProjectId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-226/AS-228: the same outsider CANNOT see the private project's task, comment, attachment, time entry, checklist item, or dependency", async () => {
      const { data: task, error: taskErr } = await outsiderClient
        .from("tasks")
        .select("id")
        .eq("id", privateTaskId);
      expect(taskErr).toBeNull();
      expect(task).toEqual([]);

      const { data: comment, error: commentErr } = await outsiderClient
        .from("comments")
        .select("id")
        .eq("id", privateCommentId);
      expect(commentErr).toBeNull();
      expect(comment).toEqual([]);

      const { data: attachment, error: attachmentErr } = await outsiderClient
        .from("attachments")
        .select("id")
        .eq("id", privateAttachmentId);
      expect(attachmentErr).toBeNull();
      expect(attachment).toEqual([]);

      const { data: timeEntry, error: timeEntryErr } = await outsiderClient
        .from("time_entries")
        .select("id")
        .eq("id", privateTimeEntryId);
      expect(timeEntryErr).toBeNull();
      expect(timeEntry).toEqual([]);

      const { data: checklistItem, error: checklistErr } = await outsiderClient
        .from("checklist_items")
        .select("id")
        .eq("id", privateChecklistItemId);
      expect(checklistErr).toBeNull();
      expect(checklistItem).toEqual([]);

      const { data: dependency, error: dependencyErr } = await outsiderClient
        .from("task_dependencies")
        .select("id")
        .eq("blocking_task_id", privateTaskId);
      expect(dependencyErr).toBeNull();
      expect(dependency).toEqual([]);
    });

    it("AS-228: the outsider also gets zero rows via a full-list query, even with a valid session in the same workspace", async () => {
      const { data, error } = await outsiderClient.from("projects").select("id, visibility");
      expect(error).toBeNull();
      expect(data?.some((row) => row.id === privateProjectId)).toBe(false);
    });

    it("AS-226: the outsider CANNOT write to the private project's checklist_items or task_dependencies either", async () => {
      const { data: updateData, error: updateErr } = await outsiderClient
        .from("checklist_items")
        .update({ is_checked: true })
        .eq("id", privateChecklistItemId)
        .select("id");
      expect(updateErr).toBeNull();
      expect(updateData).toEqual([]);

      const { data: insertData, error: insertErr } = await outsiderClient
        .from("task_dependencies")
        .insert({ blocking_task_id: privateDependentTaskId, blocked_task_id: privateTaskId })
        .select("id");
      // Denied either by the RLS with-check (silently, empty data + error
      // depending on driver) — assert it did not create a row visible to
      // the admin client either way.
      if (!insertErr) {
        expect(insertData).toEqual([]);
      }
      const { data: reread } = await adminClient
        .from("task_dependencies")
        .select("id")
        .eq("blocking_task_id", privateDependentTaskId)
        .eq("blocked_task_id", privateTaskId);
      expect(reread).toEqual([]);
    });

    // ---------------------------------------------------------------
    // AS-227: workspace-wide project access unchanged
    // ---------------------------------------------------------------

    it("AS-227: a workspace member with NO explicit project_members row CAN see the workspace-wide project and its task", async () => {
      const { data: proj, error: projErr } = await outsiderClient
        .from("projects")
        .select("id")
        .eq("id", workspaceProjectId);
      expect(projErr).toBeNull();
      expect(proj).toHaveLength(1);

      const { data: task, error: taskErr } = await outsiderClient
        .from("tasks")
        .select("id")
        .eq("id", workspaceTaskId);
      expect(taskErr).toBeNull();
      expect(task).toHaveLength(1);
    });

    it("AS-227: every workspace member (owner, member, outsider) sees the workspace-wide project — existing workspace-wide access is unchanged", async () => {
      for (const client of [ownerClient, memberClient, outsiderClient]) {
        const { data, error } = await client
          .from("projects")
          .select("id")
          .eq("id", workspaceProjectId);
        expect(error).toBeNull();
        expect(data).toHaveLength(1);
      }
    });

    // ---------------------------------------------------------------
    // AS-229: only owners/admins can change visibility
    // ---------------------------------------------------------------

    it("AS-229: a workspace owner CAN change a project's visibility from workspace to private", async () => {
      const { data, error } = await ownerClient
        .from("projects")
        .update({ visibility: "private" })
        .eq("id", workspaceProjectId)
        .select("id, visibility");
      expect(error).toBeNull();
      expect(data?.[0]?.visibility).toBe("private");

      // Revert so later assertions/cleanup are unaffected.
      const { error: revertErr } = await adminClient
        .from("projects")
        .update({ visibility: "workspace" })
        .eq("id", workspaceProjectId);
      expect(revertErr).toBeNull();
    });

    it("AS-229: a plain workspace member (not owner/admin) CANNOT change a project's visibility; the database rejects it and the value is unchanged", async () => {
      const { error } = await memberClient
        .from("projects")
        .update({ visibility: "private" })
        .eq("id", workspaceProjectId)
        .select("id, visibility");

      expect(error).not.toBeNull();

      const { data: reread } = await adminClient
        .from("projects")
        .select("visibility")
        .eq("id", workspaceProjectId)
        .single();
      expect(reread?.visibility).toBe("workspace");
    });

    it("AS-229: the same plain member CAN still update a non-visibility field on the project (visibility is the only column gated)", async () => {
      const { data, error } = await memberClient
        .from("projects")
        .update({ name: "F132 workspace-wide project (renamed)" })
        .eq("id", workspaceProjectId)
        .select("id, name");
      expect(error).toBeNull();
      expect(data?.[0]?.name).toBe("F132 workspace-wide project (renamed)");
    });
  },
);
