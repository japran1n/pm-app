// Integration test for F011 (missions/20260903-portal, M2 — Approvals):
// a `changes_requested` decision creates the work it implies. Covers
// AS-025. Same real-signed-in-session, direct-RPC pattern as
// tests/integration/f007-approvals-rls.test.ts — the point is exercising
// `decide_approval_atomic` itself, not a mock of it.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    "F011: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)("F011 decide_approval_atomic changes_requested creates work (AS-025)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient; // the named 'content' decision owner

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let clientId: string;
  let clientEmail: string;

  let subjectTaskId: string;

  const createdUserIds: string[] = [];

  async function signInAs(email: string) {
    const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`sign in ${email}: ${error.message}`);
    return session;
  }

  async function insertPendingRequest(subjectId: string) {
    const { data, error } = await admin
      .from("approval_requests")
      .insert({
        project_id: projectId,
        decision_type: "content",
        subject_type: "task",
        subject_id: subjectId,
        title: "Homepage moodboard",
        requested_by: ownerId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(`approval request: ${error?.message}`);
    return data.id as string;
  }

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f011-changes-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    clientId = clientUser.id;
    clientEmail = clientUser.email;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F011 changes-requested test", slug: `f011-changes-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project, error: projectError } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "F011 project",
        visibility: "workspace",
        created_by: ownerId,
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
    projectId = project.id;

    await admin.from("project_members").insert([
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Homepage moodboard",
        status: "todo",
        author_id: ownerId,
        client_visible: true,
      })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`task: ${taskError?.message}`);
    subjectTaskId = task.id;

    await admin.from("project_decision_owners").insert({
      project_id: projectId,
      decision_type: "content",
      user_id: clientId,
    });

    clientSession = await signInAs(clientEmail);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("comments").delete().eq("task_id", subjectTaskId);
    await admin.from("approval_requests").delete().eq("project_id", projectId);
    await admin.from("project_decision_owners").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().eq("project_id", projectId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("test_AS_025_primary_success_a_changes_requested_decision_creates_exactly_one_task_carrying_the_note_linked_back_in_one_transaction", async () => {
    const requestId = await insertPendingRequest(subjectTaskId);

    const { data, error } = await clientSession.rpc("decide_approval_atomic", {
      p_request_id: requestId,
      p_decision: "changes_requested",
      p_note: "The hero image needs to be swapped for the new brand photography.",
    });
    expect(error).toBeNull();
    const row = Array.isArray(data) ? data[0] : data;
    expect(row?.state).toBe("changes_requested");
    expect(row?.resulting_task_id).toBeTruthy();

    // The approval row itself carries the link (AS-025's "linked back to
    // the approval").
    const { data: approvalRow } = await admin
      .from("approval_requests")
      .select("resulting_task_id, state")
      .eq("id", requestId)
      .single();
    expect(approvalRow?.resulting_task_id).toBe(row?.resulting_task_id);
    expect(approvalRow?.state).toBe("changes_requested");

    // Exactly one task was created, in this project, carrying the note,
    // not client-visible by default (spec: "the team decides what to
    // show").
    const { data: createdTask } = await admin
      .from("tasks")
      .select("id, project_id, title, description, client_visible, assignee_id")
      .eq("id", row!.resulting_task_id)
      .single();
    expect(createdTask?.project_id).toBe(projectId);
    expect(createdTask?.title).toContain("Homepage moodboard");
    expect(createdTask?.description).toContain(
      "The hero image needs to be swapped for the new brand photography.",
    );
    expect(createdTask?.client_visible).toBe(false);
    expect(createdTask?.assignee_id).toBe(ownerId);

    // Only one task exists whose title carries this approval's prefix —
    // "exactly one task", not one per retry/side-effect.
    const { data: allNamedTasks } = await admin
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .ilike("title", "Changes requested:%");
    expect(allNamedTasks).toHaveLength(1);

    // AS-025 / F024 carry-over: the note also landed as a comment on the
    // subject task.
    const { data: comments } = await admin
      .from("comments")
      .select("text")
      .eq("task_id", subjectTaskId);
    expect(comments?.some((c) => c.text.includes("The hero image needs to be swapped"))).toBe(true);
  });

  // Every column the new task's INSERT itself writes is guaranteed valid
  // by OTHER constraints already enforced earlier in the same
  // transaction (or earlier still, at approval-creation time): the
  // project always has >= 1 project_statuses row (the
  // prevent_last_project_status_delete trigger — confirmed by hand
  // during this feature's implementation: deleting every status for a
  // project is rejected outright, "A project must have at least one
  // board column."), requested_by/decided_by are FK-guaranteed to exist
  // (project_decision_owners.user_id / approval_requests.requested_by),
  // and phase_id/task_type_id use ON DELETE SET NULL so they can never
  // dangle. The one genuinely unguarded write in this whole extension is
  // the COMMENT insert against the subject's `subject_id` — by design
  // `approval_requests.subject_id` carries NO FK at all (this table's
  // own migration comment: "no FK, same precedent as audit_log.target_id
  // ... validity ... is a read-time/write-time application concern, not
  // a schema one"), so a subject task that no longer exists by decision
  // time is the one real, reachable way any of this feature's own writes
  // can fail. This test forces exactly that and proves the ENTIRE
  // transaction rolls back — the just-inserted resulting task included,
  // not just the decision — which is AS-025's actual invariant: a client
  // must never see "changes requested" landed with no work (or
  // HALF-created work) behind it.
  it("test_AS_025_failure_if_a_write_this_decision_makes_fails_the_whole_decision_does_not_land_either", async () => {
    const missingSubjectId = "00000000-0000-4000-8000-000000000000";
    const { data: request, error: requestError } = await admin
      .from("approval_requests")
      .insert({
        project_id: projectId,
        decision_type: "content",
        subject_type: "task",
        // No `tasks` row with this id has ever existed — subject_id
        // carries no FK, so this insert (via the admin/service-role
        // client, bypassing the AS-020 RLS gate a real team-member
        // session would hit) succeeds regardless.
        subject_id: missingSubjectId,
        title: "Approval on a since-vanished subject",
        requested_by: ownerId,
      })
      .select("id")
      .single();
    if (requestError || !request) throw new Error(`approval request: ${requestError?.message}`);
    const requestId = request.id as string;

    const { data, error } = await clientSession.rpc("decide_approval_atomic", {
      p_request_id: requestId,
      p_decision: "changes_requested",
      p_note: "This should never land.",
    });

    expect(data).toBeNull();
    expect(error).not.toBeNull();

    // The client must never see "changes requested" recorded with no
    // work behind it: the approval is still pending, no resulting task
    // link — the WHOLE transaction rolled back.
    const { data: approvalRow } = await admin
      .from("approval_requests")
      .select("state, resulting_task_id, decided_by")
      .eq("id", requestId)
      .single();
    expect(approvalRow?.state).toBe("pending");
    expect(approvalRow?.resulting_task_id).toBeNull();
    expect(approvalRow?.decided_by).toBeNull();

    // No half-created task was left behind either — the task INSERT
    // that ran before the failing comment INSERT was rolled back too,
    // proving this is whole-transaction atomicity, not "the decision
    // failed but the task it tried to create is still sitting there".
    const { data: leakedTasks } = await admin
      .from("tasks")
      .select("id")
      .eq("project_id", projectId)
      .ilike("title", "%vanished subject%");
    expect(leakedTasks).toEqual([]);
  });
});
