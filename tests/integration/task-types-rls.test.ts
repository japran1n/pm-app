// Integration test for F434-F440 (task types) — RLS write scope. Same
// shape as tests/integration/status-templates-rls.test.ts: a plain
// workspace member can read but not write; an admin can write; a task
// type is scoped to its own workspace's tasks.

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

describe.skipIf(!haveCreds)("task types — RLS write scope", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let adminSession: SupabaseClient;

  let workspaceId: string;
  const createdUserIds: string[] = [];
  const createdTaskTypeIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `task-types-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`create ${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const member = await makeUser("member");
    const adminUser = await makeUser("admin");

    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "Task Types RLS workspace", slug: `task-types-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    const { error: membersErr } = await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: member.id, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: adminUser.id, role: "admin", status: "active" },
    ]);
    if (membersErr) throw new Error(`members: ${membersErr.message}`);

    const { data: seedType, error: seedTypeErr } = await admin
      .from("task_types")
      .insert({ workspace_id: workspaceId, name: "Dev", color: "#3b82f6", position: 1000 })
      .select("id")
      .single();
    if (seedTypeErr || !seedType) throw new Error(`seed type: ${seedTypeErr?.message}`);
    createdTaskTypeIds.push(seedType.id);

    const signIn = async (email: string) => {
      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    memberSession = await signIn(member.email);
    adminSession = await signIn(adminUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("task_types").delete().eq("workspace_id", workspaceId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("a plain member can read task types", async () => {
    const { data, error } = await memberSession
      .from("task_types")
      .select("id, name")
      .eq("workspace_id", workspaceId);

    expect(error).toBeNull();
    expect(data?.map((t) => t.name)).toContain("Dev");
  });

  it("a plain member cannot create a task type directly (RLS, not just the Server Action)", async () => {
    const { error } = await memberSession.from("task_types").insert({
      workspace_id: workspaceId,
      name: "Member-created type",
      color: "#3b82f6",
    });

    expect(error).not.toBeNull();
  });

  it("an admin can create a task type directly", async () => {
    const { data, error } = await adminSession
      .from("task_types")
      .insert({ workspace_id: workspaceId, name: "SEO", color: "#16a34a", position: 2000 })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data).toBeDefined();
    if (data) createdTaskTypeIds.push(data.id);
  });

  it("deleting a task type in use sets the task's task_type_id to null, not a cascade delete", async () => {
    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "RLS test project", visibility: "workspace" })
      .select("id")
      .single();
    expect(projectErr).toBeNull();

    const { data: task, error: taskErr } = await admin
      .from("tasks")
      .insert({
        project_id: project!.id,
        title: "Task tagged with a type",
        status: "todo",
        author_id: createdUserIds[0],
        task_type_id: createdTaskTypeIds[0],
      })
      .select("id")
      .single();
    expect(taskErr).toBeNull();

    await admin.from("task_types").delete().eq("id", createdTaskTypeIds[0]);
    createdTaskTypeIds.shift();

    const { data: reloadedTask, error: reloadErr } = await admin
      .from("tasks")
      .select("id, task_type_id")
      .eq("id", task!.id)
      .single();

    expect(reloadErr).toBeNull();
    expect(reloadedTask?.task_type_id).toBeNull();

    await admin.from("tasks").delete().eq("id", task!.id);
    await admin.from("projects").delete().eq("id", project!.id);
  });
});
