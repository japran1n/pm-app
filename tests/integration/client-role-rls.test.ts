// Integration test for the `client` workspace role (C1/C2, see
// docs/client-portal-plan.md).
//
// A client is an external party, so almost everything here is an assertion
// about what they CANNOT read. Each case builds a real workspace with a real
// signed-in client session and goes through PostgREST, because that is the
// only way to exercise the RLS policies themselves — a Server Action test
// would pass even if every policy were missing.
//
// The second describe block is the regression half: the same fixtures read
// by an ordinary team member, asserting the shared predicates
// (`is_project_visible_to`, `is_task_visible_to`, `is_project_visible_to_row`)
// still behave exactly as before for everyone who is not a client. Those
// predicates back nearly every policy in the schema, so widening them
// without this half would be reckless.

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
    if (key && !(key in process.env)) process.env[key] = value;
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

describe.skipIf(!haveCreds)("`client` workspace role — RLS read scope", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;
  let memberSession: SupabaseClient;

  let workspaceId: string;
  let sharedProjectId: string;
  let otherProjectId: string;
  let sharedTaskId: string;
  let internalTaskId: string;
  let ownerUserId: string;
  let memberUserId: string;
  let clientUserId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `client-rls-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Failed to create ${label} user: ${error?.message}`);
      }
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const member = await makeUser("member");
    const clientUser = await makeUser("client");
    ownerUserId = owner.id;
    memberUserId = member.id;
    clientUserId = clientUser.id;

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "Client RLS workspace", slug: `client-rls-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    const { error: membersErr } = await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientUserId, role: "client", status: "active" },
    ]);
    if (membersErr) throw new Error(`members: ${membersErr.message}`);

    // Two projects: the client is added to the first only. Both are
    // workspace-visible, so "the client sees only their own project" is a
    // statement about the client role, not about project privacy.
    const insertProject = async (name: string) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerUserId,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };
    sharedProjectId = await insertProject("Shared with client");
    otherProjectId = await insertProject("Not shared with client");

    const { error: pmErr } = await admin.from("project_members").insert([
      { project_id: sharedProjectId, user_id: memberUserId, project_role: "lead", added_by: ownerUserId },
      { project_id: sharedProjectId, user_id: clientUserId, project_role: "member", added_by: ownerUserId },
    ]);
    if (pmErr) throw new Error(`project_members: ${pmErr.message}`);

    const insertTask = async (title: string, clientVisible: boolean) => {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: sharedProjectId,
          title,
          status: "todo",
          author_id: ownerUserId,
          assignee_id: memberUserId,
          client_visible: clientVisible,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task ${title}: ${error?.message}`);
      return data.id as string;
    };
    sharedTaskId = await insertTask("Shared with the client", true);
    internalTaskId = await insertTask("Internal only", false);

    // Internal metadata hanging off the SHARED task: if any of it reaches
    // the client, the leak is on a task they are legitimately allowed to see,
    // which is the subtle case worth testing.
    await admin.from("task_assignees").insert({
      task_id: sharedTaskId,
      user_id: memberUserId,
      assigned_by: ownerUserId,
    });
    await admin.from("time_entries").insert({
      task_id: sharedTaskId,
      user_id: memberUserId,
      minutes: 90,
      billable: true,
      note: "internal billing note",
    });

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
    memberSession = await signIn(member.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("time_entries").delete().eq("task_id", sharedTaskId);
    await admin.from("task_assignees").delete().eq("task_id", sharedTaskId);
    await admin.from("tasks").delete().in("id", [sharedTaskId, internalTaskId]);
    await admin.from("project_members").delete().eq("project_id", sharedProjectId);
    await admin.from("project_statuses").delete().in("project_id", [sharedProjectId, otherProjectId]);
    await admin.from("projects").delete().in("id", [sharedProjectId, otherProjectId]);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("sees only tasks explicitly marked client_visible", async () => {
    const { data, error } = await clientSession.from("tasks").select("id, title");
    expect(error).toBeNull();
    expect(data?.map((t) => t.id)).toEqual([sharedTaskId]);
  });

  it("sees only the project they were added to, even though both are workspace-visible", async () => {
    const { data, error } = await clientSession.from("projects").select("id");
    expect(error).toBeNull();
    expect(data?.map((p) => p.id)).toEqual([sharedProjectId]);
  });

  it("cannot read logged time or billability on a task they can see", async () => {
    const { data, error } = await clientSession.from("time_entries").select("id, minutes");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot read who is assigned to a task they can see", async () => {
    const { data, error } = await clientSession.from("task_assignees").select("task_id");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("cannot enumerate the team: workspace_members returns only their own row", async () => {
    const { data, error } = await clientSession.from("workspace_members").select("user_id, role");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0].user_id).toBe(clientUserId);
    expect(data?.[0].role).toBe("client");
  });

  it("cannot read other members' profiles", async () => {
    const { data, error } = await clientSession
      .from("profiles")
      .select("id")
      .in("id", [ownerUserId, memberUserId, clientUserId]);
    expect(error).toBeNull();
    expect(data?.map((p) => p.id)).toEqual([clientUserId]);
  });

  it("cannot create a task", async () => {
    const { error } = await clientSession.from("tasks").insert({
      project_id: sharedProjectId,
      title: "client attempts a write",
      status: "todo",
      author_id: clientUserId,
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  it("cannot comment, even on a task shared with them (deliberate: C7 opens this)", async () => {
    const { error } = await clientSession.from("comments").insert({
      task_id: sharedTaskId,
      user_id: clientUserId,
      text: "client attempts a comment",
    });
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
  });

  // --- regression: nothing changed for the team ---------------------------

  it("regression: a plain member still sees every task, shared or not", async () => {
    const { data, error } = await memberSession
      .from("tasks")
      .select("id")
      .eq("project_id", sharedProjectId);
    expect(error).toBeNull();
    expect(data?.map((t) => t.id).sort()).toEqual([sharedTaskId, internalTaskId].sort());
  });

  it("regression: a plain member still sees both workspace-visible projects", async () => {
    const { data, error } = await memberSession
      .from("projects")
      .select("id")
      .in("id", [sharedProjectId, otherProjectId]);
    expect(error).toBeNull();
    expect(data).toHaveLength(2);
  });

  it("regression: a plain member still sees time entries and assignees", async () => {
    const { data: time, error: timeErr } = await memberSession
      .from("time_entries")
      .select("id")
      .eq("task_id", sharedTaskId);
    expect(timeErr).toBeNull();
    expect(time).toHaveLength(1);

    const { data: assignees, error: assigneeErr } = await memberSession
      .from("task_assignees")
      .select("user_id")
      .eq("task_id", sharedTaskId);
    expect(assigneeErr).toBeNull();
    expect(assignees).toHaveLength(1);
  });

  it("regression: a plain member still sees the whole roster and fellow profiles", async () => {
    const { data: members, error: membersErr } = await memberSession
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId);
    expect(membersErr).toBeNull();
    expect(members).toHaveLength(3);

    const { data: profiles, error: profilesErr } = await memberSession
      .from("profiles")
      .select("id")
      .in("id", [ownerUserId, memberUserId]);
    expect(profilesErr).toBeNull();
    expect(profiles).toHaveLength(2);
  });
});
