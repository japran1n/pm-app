// Integration test for client_requests (C5/C6, docs/client-portal-plan.md).
//
// The table exists so a client has exactly one thing they may write, and
// the value of that is entirely in the boundaries: a client may file a
// request and correct it while nobody has looked at it, and may do nothing
// else — not accept their own request, not read another client's, not
// touch the tasks board. Each of those is a case below, driven through
// real signed-in sessions and PostgREST so the policies themselves are
// what is being tested.

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
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";
const RLS_DENIED = "42501";

describe.skipIf(!haveCreds)("client_requests — RLS", () => {
  let admin: SupabaseClient;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let member: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let ownerId: string;
  let memberId: string;
  let clientAId: string;
  let clientBId: string;
  let requestId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `creq-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const memberUser = await makeUser("member");
    const clientAUser = await makeUser("clienta");
    const clientBUser = await makeUser("clientb");
    ownerId = owner.id;
    memberId = memberUser.id;
    clientAId = clientAUser.id;
    clientBId = clientBUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "Client requests test", slug: `creq-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientAId, role: "client", status: "active" },
      { workspace_id: workspaceId, user_id: clientBId, role: "client", status: "active" },
    ]);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "Shared project",
        visibility: "workspace",
        created_by: ownerId,
        // F001 (missions/20260903-portal): a client's task read scope now
        // also requires the project's portal switch — this suite's "the
        // client can then see the resulting task" case below depends on
        // it being on, since `portal_enabled` defaults false.
        portal_enabled: true,
      })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    projectId = project.id;

    // BOTH clients are on the same project — the case that makes "a client
    // sees only their own requests" a real assertion rather than a
    // side-effect of project scoping.
    await admin.from("project_members").insert([
      { project_id: projectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectId, user_id: clientAId, project_role: "member", added_by: ownerId },
      { project_id: projectId, user_id: clientBId, project_role: "member", added_by: ownerId },
    ]);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };

    clientA = await signIn(clientAUser.email);
    clientB = await signIn(clientBUser.email);
    member = await signIn(memberUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("client_requests").delete().eq("project_id", projectId);
    await admin.from("tasks").delete().eq("project_id", projectId);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("project_statuses").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("a client can file a request on a project they belong to", async () => {
    const { data, error } = await clientA
      .from("client_requests")
      .insert({
        project_id: projectId,
        created_by: clientAId,
        title: "Add a cookie banner",
        body: "Legal asked for it.",
      })
      .select("id, status")
      .single();

    expect(error).toBeNull();
    expect(data?.status).toBe("submitted");
    requestId = data!.id;
  });

  it("a client cannot file a request attributed to someone else", async () => {
    const { error } = await clientA.from("client_requests").insert({
      project_id: projectId,
      created_by: clientBId,
      title: "Filed on behalf of another client",
    });
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("a client cannot file a request that arrives pre-accepted", async () => {
    const { error } = await clientA.from("client_requests").insert({
      project_id: projectId,
      created_by: clientAId,
      title: "Pre-accepted",
      status: "accepted",
    });
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("a client cannot read another client's request on the same project", async () => {
    const { data, error } = await clientB
      .from("client_requests")
      .select("id")
      .eq("id", requestId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("the team sees the request", async () => {
    const { data, error } = await member
      .from("client_requests")
      .select("id, title")
      .eq("id", requestId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("a client cannot accept their own request", async () => {
    const { data, error } = await clientA
      .from("client_requests")
      .update({ status: "accepted" })
      .eq("id", requestId)
      .select("id");

    // The UPDATE policy's WITH CHECK pins status to 'submitted', so this is
    // rejected outright rather than silently matching zero rows.
    expect(error?.code ?? (data?.length === 0 ? RLS_DENIED : "allowed")).toBe(
      RLS_DENIED,
    );
  });

  it("a client can correct their own request while it is still untouched", async () => {
    const { data, error } = await clientA
      .from("client_requests")
      .update({ title: "Add a cookie banner (analytics only)" })
      .eq("id", requestId)
      .select("title")
      .single();

    expect(error).toBeNull();
    expect(data?.title).toBe("Add a cookie banner (analytics only)");
  });

  it("a declined request must carry a reason (DB constraint, not just UI)", async () => {
    const { error } = await member
      .from("client_requests")
      .update({ status: "declined" })
      .eq("id", requestId);

    // 23514 = check_violation: client_requests_decline_reason_matches_status
    expect(error?.code).toBe("23514");
  });

  it("the team can accept, and the client can then see the resulting task", async () => {
    const { data: task, error: taskError } = await member
      .from("tasks")
      .insert({
        project_id: projectId,
        title: "Add a cookie banner (analytics only)",
        status: "todo",
        author_id: memberId,
        client_visible: true,
      })
      .select("id")
      .single();
    expect(taskError).toBeNull();

    const { error: linkError } = await member
      .from("client_requests")
      .update({
        status: "accepted",
        converted_task_id: task!.id,
        reviewed_by: memberId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    expect(linkError).toBeNull();

    const { data: visible, error: visibleError } = await clientA
      .from("tasks")
      .select("id")
      .eq("id", task!.id);
    expect(visibleError).toBeNull();
    expect(visible).toHaveLength(1);
  });

  it("a client cannot correct a request once it has been decided", async () => {
    const { data, error } = await clientA
      .from("client_requests")
      .update({ title: "Changing my mind after the fact" })
      .eq("id", requestId)
      .select("id");

    expect(error?.code ?? (data?.length === 0 ? "no-rows" : "allowed")).not.toBe(
      "allowed",
    );
  });

  it("a client cannot withdraw a request once it has been decided", async () => {
    const { data, error } = await clientA
      .from("client_requests")
      .delete()
      .eq("id", requestId)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: still } = await member
      .from("client_requests")
      .select("id")
      .eq("id", requestId);
    expect(still).toHaveLength(1);
  });
});
