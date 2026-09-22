// Integration test for F010 (missions/20260903-portal, M2 — Approvals):
// the team-wide approvals queue (AS-027). Mirrors the
// loadDotEnv/vi.mock("@/lib/supabase/server")/skipIf pattern established by
// tests/integration/assignee-ids-query-wiring.test.ts — calls the REAL
// `getOpenApprovalsForWorkspace`/`getDecisionOwnerNames`
// (lib/queries/approvals.ts) against a real Supabase project through a
// signed-in team member session, not a mocked query builder.
//
// Primary success test (this feature's own definition of done): the
// queue returns open requests across SEVERAL projects of the workspace,
// oldest first, and excludes settled (withdrawn/approved) ones. Also
// covers "what it blocks" derivation for a task-subject request (AS-027's
// own "queue... across projects" wording implies these rows carry enough
// to act on).

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
  for (const line of readFileSync(path, "utf8").split("\n")) {
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
    "F010: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)("F010 — getOpenApprovalsForWorkspace (AS-027)", () => {
  let admin: SupabaseClient;
  let workspaceId: string;
  let projectAId: string;
  let projectBId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;
  let taskId: string;
  let phaseId: string;
  const createdUserIds: string[] = [];
  const createdRequestIds: string[] = [];

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f010-approvals-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F010 approvals queue test", slug: `f010-approvals-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    // AS-027's own wording: "across several projects" — two distinct
    // projects of the same workspace.
    projectAId = await insertProject("Project A");
    projectBId = await insertProject("Project B");

    await admin.from("project_members").insert([
      { project_id: projectAId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectAId, user_id: clientId, project_role: "member", added_by: ownerId },
      { project_id: projectBId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectBId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    // A phase + a client-visible task on project A — "what it blocks"
    // (name the task and its phase) needs both.
    const { data: phase, error: phaseError } = await admin
      .from("project_phases")
      .insert({ project_id: projectAId, name: "Design", position: 0 })
      .select("id")
      .single();
    if (phaseError || !phase) throw new Error(`phase: ${phaseError?.message}`);
    phaseId = phase.id;

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .insert({
        project_id: projectAId,
        title: "Homepage moodboard",
        status: "todo",
        author_id: ownerId,
        client_visible: true,
        phase_id: phaseId,
      })
      .select("id")
      .single();
    if (taskError || !task) throw new Error(`task: ${taskError?.message}`);
    taskId = task.id;

    await admin.from("project_decision_owners").insert([
      { project_id: projectAId, decision_type: "content", user_id: clientId },
      { project_id: projectBId, decision_type: "brand", user_id: clientId },
    ]);

    // Three requests: oldest (project A, task-subject), middle (project
    // B, artifact-subject), and a withdrawn one that must NOT appear in
    // the queue at all. `requested_at` is backdated via direct admin
    // insert so ordering is deterministic without a real sleep.
    const now = Date.now();
    const insertRequest = async (opts: {
      projectId: string;
      subjectType: "task" | "artifact";
      subjectId?: string;
      artifactUrl?: string;
      decisionType: "content" | "brand";
      requestedAt: string;
      state?: "pending" | "withdrawn";
    }) => {
      const { data, error } = await admin
        .from("approval_requests")
        .insert({
          project_id: opts.projectId,
          subject_type: opts.subjectType,
          subject_id: opts.subjectId ?? null,
          artifact_url: opts.artifactUrl ?? null,
          title: `Approval for ${opts.projectId}`,
          decision_type: opts.decisionType,
          requested_by: memberId,
          requested_at: opts.requestedAt,
          state: opts.state ?? "pending",
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`request insert: ${error?.message}`);
      createdRequestIds.push(data.id);
      return data.id as string;
    };

    await insertRequest({
      projectId: projectAId,
      subjectType: "task",
      subjectId: taskId,
      decisionType: "content",
      requestedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await insertRequest({
      projectId: projectBId,
      subjectType: "artifact",
      artifactUrl: "https://example.com/design.png",
      decisionType: "brand",
      requestedAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString(),
    });
    await insertRequest({
      projectId: projectAId,
      subjectType: "artifact",
      artifactUrl: "https://example.com/withdrawn.png",
      decisionType: "content",
      requestedAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
      state: "withdrawn",
    });

    const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await session.auth.signInWithPassword({
      email: memberUser.email,
      password: PASSWORD,
    });
    if (signInError) throw new Error(`sign in: ${signInError.message}`);
    memberClient = session;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("approval_requests").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("project_decision_owners").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("tasks").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("project_phases").delete().eq("id", phaseId);
    await admin.from("project_members").delete().in("project_id", [projectAId, projectBId]);
    await admin.from("projects").delete().in("id", [projectAId, projectBId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("AS_027_queue_returns_open_requests_across_projects_oldest_first_excludes_settled", async () => {
    const { getOpenApprovalsForWorkspace } = await import("@/lib/queries/approvals");
    const { list: rows, error } = await getOpenApprovalsForWorkspace(workspaceId);
    expect(error).toBeUndefined();

    // Excludes the withdrawn request entirely — never surfaced, not even
    // as a settled row (this queue only shows OPEN requests).
    expect(rows.every((r) => r.state === "pending")).toBe(true);
    expect(rows.length).toBe(2);

    // Oldest first, across both projects — not grouped by project, not by
    // due date.
    expect(rows[0].projectId).toBe(projectAId);
    expect(rows[1].projectId).toBe(projectBId);
    expect(new Date(rows[0].requestedAt).getTime()).toBeLessThan(
      new Date(rows[1].requestedAt).getTime(),
    );

    // "What it blocks": the task-subject row names the task AND its
    // phase, derived — not typed by the PM.
    expect(rows[0].blocks).toEqual({ label: "Homepage moodboard", phaseName: "Design" });
    // The artifact-subject row has nothing in-app to name.
    expect(rows[1].blocks).toBeNull();
  });

  it("AS_027_decision_owner_names_resolve_per_project_and_decision_type", async () => {
    const { getOpenApprovalsForWorkspace, getDecisionOwnerNames } = await import(
      "@/lib/queries/approvals"
    );
    const { list: rows } = await getOpenApprovalsForWorkspace(workspaceId);
    const owners = await getDecisionOwnerNames(
      rows.map((r) => ({ projectId: r.projectId, decisionType: r.decisionType })),
    );

    expect(owners.has(`${projectAId}:content`)).toBe(true);
    expect(owners.has(`${projectBId}:brand`)).toBe(true);
  });
});
