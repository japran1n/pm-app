// Integration test for C7: a client may take part in the conversation on
// work shared with them, and must never see the team's internal thread on
// the same task.
//
// The interesting case is the last one: internal and non-internal comments
// on the SAME task, read by a client. Anything that scopes by task alone
// passes the other cases and fails this one.

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

describe.skipIf(!haveCreds)("comments — client access and internal threads", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;
  let memberSession: SupabaseClient;

  let workspaceId: string;
  let projectId: string;
  let sharedTaskId: string;
  let internalTaskId: string;
  let sharedPublicCommentId: string;
  let sharedInternalCommentId: string;
  let ownerId: string;
  let memberId: string;
  let clientId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `ccom-${label}-${suffix}@example.com`,
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

    const { data: workspace } = await admin
      .from("workspaces")
      .insert({ name: "Client comments test", slug: `ccom-${suffix}` })
      .select("id")
      .single();
    workspaceId = workspace!.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: memberId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const { data: project } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "Shared project",
        visibility: "workspace",
        created_by: ownerId,
        // F001 (missions/20260903-portal): a client's read scope now also
        // requires the project's portal to be switched on — without this
        // every "a client sees ..." assertion below would see nothing,
        // since `portal_enabled` defaults false.
        portal_enabled: true,
      })
      .select("id")
      .single();
    projectId = project!.id;

    await admin.from("project_members").insert([
      { project_id: projectId, user_id: memberId, project_role: "lead", added_by: ownerId },
      { project_id: projectId, user_id: clientId, project_role: "member", added_by: ownerId },
    ]);

    const insertTask = async (title: string, clientVisible: boolean) => {
      const { data } = await admin
        .from("tasks")
        .insert({
          project_id: projectId,
          title,
          status: "todo",
          author_id: ownerId,
          client_visible: clientVisible,
        })
        .select("id")
        .single();
      return data!.id as string;
    };
    sharedTaskId = await insertTask("Shared task", true);
    internalTaskId = await insertTask("Internal task", false);

    const insertComment = async (
      taskId: string,
      text: string,
      internal: boolean,
    ) => {
      const { data } = await admin
        .from("comments")
        .insert({ task_id: taskId, user_id: memberId, text, internal })
        .select("id")
        .single();
      return data!.id as string;
    };
    sharedPublicCommentId = await insertComment(
      sharedTaskId,
      "Here is the draft for your review.",
      false,
    );
    sharedInternalCommentId = await insertComment(
      sharedTaskId,
      "We should bill this as scope creep.",
      true,
    );

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
    memberSession = await signIn(memberUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("comments").delete().in("task_id", [sharedTaskId, internalTaskId]);
    await admin.from("tasks").delete().in("id", [sharedTaskId, internalTaskId]);
    await admin.from("project_members").delete().eq("project_id", projectId);
    await admin.from("project_statuses").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
  }, 60_000);

  it("a client sees the non-internal comment on a shared task, and NOT the internal one on the same task", async () => {
    const { data, error } = await clientSession
      .from("comments")
      .select("id")
      .eq("task_id", sharedTaskId);

    expect(error).toBeNull();
    expect(data?.map((c) => c.id)).toEqual([sharedPublicCommentId]);
    expect(data?.map((c) => c.id)).not.toContain(sharedInternalCommentId);
  });

  it("a client cannot read comments on a task that is not shared with them", async () => {
    await admin.from("comments").insert({
      task_id: internalTaskId,
      user_id: memberId,
      text: "Internal task chatter",
      internal: false,
    });

    const { data, error } = await clientSession
      .from("comments")
      .select("id")
      .eq("task_id", internalTaskId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("a client can comment on a shared task", async () => {
    const { data, error } = await clientSession
      .from("comments")
      .insert({
        task_id: sharedTaskId,
        user_id: clientId,
        text: "Looks good, one change please.",
        internal: false,
      })
      .select("id, internal")
      .single();

    expect(error).toBeNull();
    expect(data?.internal).toBe(false);
  });

  it("a client cannot post an internal comment", async () => {
    const { error } = await clientSession.from("comments").insert({
      task_id: sharedTaskId,
      user_id: clientId,
      text: "Sneaking into the internal thread",
      internal: true,
    });
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("a client cannot comment on a task that is not shared with them", async () => {
    const { error } = await clientSession.from("comments").insert({
      task_id: internalTaskId,
      user_id: clientId,
      text: "Commenting on something I should not see",
      internal: false,
    });
    expect(error?.code).toBe(RLS_DENIED);
  });

  it("regression: the team still sees every comment on the shared task", async () => {
    const { data, error } = await memberSession
      .from("comments")
      .select("id")
      .eq("task_id", sharedTaskId);

    expect(error).toBeNull();
    // Two seeded (public + internal) plus the client's own from above.
    expect(data?.length).toBeGreaterThanOrEqual(3);
    expect(data?.map((c) => c.id)).toContain(sharedInternalCommentId);
  });
});
