// Integration test for F428-F430 (status templates) — specifically the
// SECURITY DEFINER bypass that was caught and fixed before this feature
// was ever applied to the database (see 20260903010000_status_templates.
// sql's own comment on apply_status_template): the function initially had
// NO caller-role check inside its body, meaning `grant execute ... to
// authenticated` would have let any signed-in user — including a
// non-member of the target workspace — replace any project's columns by
// calling the RPC directly, regardless of what the table-level RLS
// policies said.
//
// This drives the fix through a real signed-in session and a real RPC
// call, the only way to prove a SECURITY DEFINER function's internal
// check actually runs (a table-level RLS assertion proves nothing about
// what happens once code is executing inside a SECURITY DEFINER body).

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

describe.skipIf(!haveCreds)("status templates — apply_status_template RPC", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;

  let workspaceId: string;
  let otherWorkspaceId: string;
  let projectId: string;
  let templateId: string;
  let otherWorkspaceTemplateId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: memberAuth, error: memberAuthErr } =
      await admin.auth.admin.createUser({
        email: `status-tpl-member-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`create member user: ${memberAuthErr?.message}`);
    }
    createdUserIds.push(memberAuth.user.id);

    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "Status Template RLS workspace", slug: `status-tpl-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    // A second workspace, so the "template must belong to the project's
    // own workspace" cross-workspace guard has something real to fail
    // against, not just a synthetic uuid.
    const { data: otherWs, error: otherWsErr } = await admin
      .from("workspaces")
      .insert({ name: "Other workspace", slug: `status-tpl-other-${suffix}` })
      .select("id")
      .single();
    if (otherWsErr || !otherWs) throw new Error(`other workspace: ${otherWsErr?.message}`);
    otherWorkspaceId = otherWs.id;

    // The member is an active MEMBER (not admin/owner) of the workspace —
    // exactly the role the original, unfixed function would have let
    // through, since RLS on status_templates only ever gates whether a
    // plain table SELECT/INSERT succeeds, never a direct RPC call.
    const { error: memberErr } = await admin.from("workspace_members").insert({
      workspace_id: workspaceId,
      user_id: memberAuth.user.id,
      role: "member",
      status: "active",
    });
    if (memberErr) throw new Error(`membership: ${memberErr.message}`);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .insert({
        workspace_id: workspaceId,
        name: "Status template test project",
        visibility: "workspace",
        created_by: memberAuth.user.id,
      })
      .select("id")
      .single();
    if (projectErr || !project) throw new Error(`project: ${projectErr?.message}`);
    projectId = project.id;

    const { data: template, error: templateErr } = await admin
      .from("status_templates")
      .insert({ workspace_id: workspaceId, name: "Test template" })
      .select("id")
      .single();
    if (templateErr || !template) throw new Error(`template: ${templateErr?.message}`);
    templateId = template.id;

    await admin.from("status_template_items").insert({
      template_id: templateId,
      name: "Backlog",
      color: "#64748b",
      category: "not_started",
      position: 1000,
    });

    const { data: otherTemplate, error: otherTemplateErr } = await admin
      .from("status_templates")
      .insert({ workspace_id: otherWorkspaceId, name: "Other workspace template" })
      .select("id")
      .single();
    if (otherTemplateErr || !otherTemplate) {
      throw new Error(`other template: ${otherTemplateErr?.message}`);
    }
    otherWorkspaceTemplateId = otherTemplate.id;

    memberSession = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInErr } = await memberSession.auth.signInWithPassword({
      email: memberAuth.user.email!,
      password: PASSWORD,
    });
    if (signInErr) throw new Error(`sign in: ${signInErr.message}`);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("status_template_items").delete().eq("template_id", templateId);
    await admin
      .from("status_template_items")
      .delete()
      .eq("template_id", otherWorkspaceTemplateId);
    await admin.from("status_templates").delete().eq("id", templateId);
    await admin.from("status_templates").delete().eq("id", otherWorkspaceTemplateId);
    await admin.from("project_statuses").delete().eq("project_id", projectId);
    await admin.from("projects").delete().eq("id", projectId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().in("id", [workspaceId, otherWorkspaceId]);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  }, 60_000);

  it("a plain member (not owner/admin) cannot apply a status template via the RPC directly", async () => {
    const { error } = await memberSession.rpc("apply_status_template", {
      p_project_id: projectId,
      p_template_id: templateId,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/owner or admin/i);
  });

  it("promoting the same member to admin then lets the RPC succeed", async () => {
    const { data: memberRow } = await admin
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .single();
    await admin.from("workspace_members").update({ role: "admin" }).eq("id", memberRow!.id);

    const { error } = await memberSession.rpc("apply_status_template", {
      p_project_id: projectId,
      p_template_id: templateId,
    });

    expect(error).toBeNull();

    const { data: columns } = await admin
      .from("project_statuses")
      .select("name")
      .eq("project_id", projectId);
    expect(columns?.map((c) => c.name)).toContain("Backlog");
  });

  it("a template from a different workspace is rejected even for an admin", async () => {
    const { error } = await memberSession.rpc("apply_status_template", {
      p_project_id: projectId,
      p_template_id: otherWorkspaceTemplateId,
    });

    expect(error).not.toBeNull();
    expect(error?.message).toMatch(/workspace/i);
  });
});
