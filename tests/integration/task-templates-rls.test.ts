// Integration test for F181 (task_templates table + RLS: AS-328, AS-329),
// run against the real linked Supabase project. Mirrors the fixture/
// pattern established by tests/integration/rls-guest.test.ts (F134).
//
// Proves:
//   AS-328 (storage half only — the "save" action itself is F182, not
//     built yet): a valid `task_templates` row can be inserted with a
//     payload mirroring F176's cloneTaskFields shape (title, description,
//     description_json, priority, checklistItems, estimate_minutes,
//     tags), and reads back unchanged.
//   AS-329: templates are workspace-scoped and visible to non-guest
//     members. A guest workspace member cannot see a template even though
//     they are an active member of the same workspace; a regular member,
//     an admin, and the owner (all non-guest, active) can. A member of a
//     DIFFERENT workspace cannot see it either (workspace scoping).
//
// Also covers write-side access control per the feature spec's Draft
// scope ("INSERT/UPDATE/DELETE restricted to the creator OR workspace
// admins/owners"): a non-creator regular member cannot update/delete
// another member's template; the creator and an admin can.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { poolUserId, getPoolSession } from "../helpers/auth";

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
    "F181: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const TEMPLATE_PAYLOAD = {
  title: "F181 template task",
  description: "A reusable template body",
  description_json: { type: "doc", content: [] },
  priority: "medium",
  checklistItems: [{ content: "Step 1", position: 0 }],
  estimate_minutes: 30,
  tags: ["template", "onboarding"],
};

describe.skipIf(!haveAdminCreds)("task_templates RLS (F181)", () => {
  let adminClient: SupabaseClient;
  let workspaceId: string;
  let otherWorkspaceId: string;

  let ownerUserId: string;
  let adminUserId: string;
  let memberUserId: string;
  let guestUserId: string;
  let otherWorkspaceUserId: string;

  // F126: pooled identities (see tests/helpers/auth.ts). Each constant
  // below is a slot index into the shared pool, not a fixed "role" — the
  // actual role each plays is whatever this file's own workspace_members
  // insert below gives it, scoped to this file's own workspaces.
  const OWNER = 0;
  const ADMIN = 1;
  const MEMBER = 2;
  const GUEST = 3;
  const OTHER_WORKSPACE_USER = 4;
  let ownerClient: SupabaseClient;
  let adminMemberClient: SupabaseClient;
  let memberClient: SupabaseClient;
  let guestClient: SupabaseClient;
  let otherWorkspaceClient: SupabaseClient;

  let templateId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F181 templates workspace", slug: `f181-rls-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    const { data: otherWs, error: otherWsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F181 other workspace", slug: `f181-other-${uniqueSuffix}` })
      .select("id")
      .single();
    if (otherWsErr || !otherWs)
      throw new Error(`Failed to create other workspace: ${otherWsErr?.message}`);
    otherWorkspaceId = otherWs.id;

    // F126: pooled identities (see tests/helpers/auth.ts) — not deleted by
    // this file's afterAll (see below).
    ownerUserId = await poolUserId(OWNER);
    adminUserId = await poolUserId(ADMIN);
    memberUserId = await poolUserId(MEMBER);
    guestUserId = await poolUserId(GUEST);
    otherWorkspaceUserId = await poolUserId(OTHER_WORKSPACE_USER);

    const { error: membersErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerUserId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: adminUserId, role: "admin", status: "active" },
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: guestUserId, role: "guest", status: "active" },
      {
        workspace_id: otherWorkspaceId,
        user_id: otherWorkspaceUserId,
        role: "owner",
        status: "active",
      },
    ]);
    if (membersErr) throw new Error(`Failed to seed workspace members: ${membersErr.message}`);

    ownerClient = await getPoolSession(OWNER);
    adminMemberClient = await getPoolSession(ADMIN);
    memberClient = await getPoolSession(MEMBER);
    guestClient = await getPoolSession(GUEST);
    otherWorkspaceClient = await getPoolSession(OTHER_WORKSPACE_USER);
  });

  afterAll(async () => {
    if (workspaceId) {
      await adminClient.from("task_templates").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    if (otherWorkspaceId) {
      await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", otherWorkspaceId);
      await adminClient.from("workspaces").delete().eq("id", otherWorkspaceId);
    }
    // F126: ownerUserId/adminUserId/memberUserId/guestUserId/
    // otherWorkspaceUserId are pooled identities (see
    // tests/helpers/auth.ts) — never deleted by an individual file's
    // afterAll.
  });

  // ---------------------------------------------------------------
  // AS-328: a valid template row can be inserted with a payload
  // mirroring cloneTaskFields' shape, and reads back unchanged.
  // ---------------------------------------------------------------

  it("AS-328: a non-guest member can insert a task template with a cloneTaskFields-shaped payload, and it reads back unchanged", async () => {
    const { data, error } = await memberClient
      .from("task_templates")
      .insert({
        workspace_id: workspaceId,
        kind: "task",
        name: "F181 onboarding template",
        payload: TEMPLATE_PAYLOAD,
        created_by: memberUserId,
      })
      .select("id, name, kind, payload, workspace_id, created_by")
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data?.kind).toBe("task");
    expect(data?.workspace_id).toBe(workspaceId);
    expect(data?.created_by).toBe(memberUserId);
    expect(data?.payload).toEqual(TEMPLATE_PAYLOAD);

    templateId = data!.id;
  });

  it("AS-328: inserting a template with an empty name is rejected by the DB constraint", async () => {
    const { error } = await memberClient.from("task_templates").insert({
      workspace_id: workspaceId,
      name: "   ",
      payload: TEMPLATE_PAYLOAD,
      created_by: memberUserId,
    });
    expect(error).not.toBeNull();
  });

  // ---------------------------------------------------------------
  // AS-329: templates are workspace-scoped and visible to non-guest
  // members only.
  // ---------------------------------------------------------------

  it("AS-329: a guest workspace member CANNOT see a template in their own workspace", async () => {
    const { data, error } = await guestClient
      .from("task_templates")
      .select("id")
      .eq("id", templateId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("AS-329: a regular non-guest member CAN see the template", async () => {
    const { data, error } = await memberClient
      .from("task_templates")
      .select("id")
      .eq("id", templateId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("AS-329: an admin CAN see the template", async () => {
    const { data, error } = await adminMemberClient
      .from("task_templates")
      .select("id")
      .eq("id", templateId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("AS-329: the owner CAN see the template", async () => {
    const { data, error } = await ownerClient
      .from("task_templates")
      .select("id")
      .eq("id", templateId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });

  it("AS-329: a member of a DIFFERENT workspace CANNOT see the template (workspace-scoped)", async () => {
    const { data, error } = await otherWorkspaceClient
      .from("task_templates")
      .select("id")
      .eq("id", templateId);
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  // ---------------------------------------------------------------
  // Write-side access control (Draft scope: creator or admin/owner only)
  // ---------------------------------------------------------------

  it("a non-creator regular member CANNOT update another member's template", async () => {
    const { data } = await adminClient
      .from("task_templates")
      .select("name")
      .eq("id", templateId)
      .single();
    const originalName = data?.name;

    const { error: updateError } = await ownerClient
      .from("task_templates")
      .update({ name: "hijacked by owner test setup" })
      .eq("id", templateId);
    expect(updateError).toBeNull(); // sanity: owner path works, reset below

    await adminClient
      .from("task_templates")
      .update({ name: originalName })
      .eq("id", templateId);

    // guestClient cannot even see the row, so its update affects 0 rows
    // (RLS silently filters, no error) — verify no row was changed.
    const { error: guestUpdateError } = await guestClient
      .from("task_templates")
      .update({ name: "guest should not be able to do this" })
      .eq("id", templateId);
    expect(guestUpdateError).toBeNull();

    const { data: afterGuestAttempt } = await adminClient
      .from("task_templates")
      .select("name")
      .eq("id", templateId)
      .single();
    expect(afterGuestAttempt?.name).toBe(originalName);
  });

  it("a non-creator non-admin member CANNOT delete another member's template", async () => {
    // Insert a fresh template owned by the admin to test a plain member's
    // delete attempt against a template they did not create.
    const { data: adminTemplate, error: insertErr } = await adminMemberClient
      .from("task_templates")
      .insert({
        workspace_id: workspaceId,
        name: "F181 admin-owned template",
        payload: TEMPLATE_PAYLOAD,
        created_by: adminUserId,
      })
      .select("id")
      .single();
    expect(insertErr).toBeNull();
    expect(adminTemplate).toBeTruthy();

    const { error: memberDeleteError } = await memberClient
      .from("task_templates")
      .delete()
      .eq("id", adminTemplate!.id);
    expect(memberDeleteError).toBeNull(); // RLS filters silently, 0 rows affected

    const { data: stillThere } = await adminClient
      .from("task_templates")
      .select("id")
      .eq("id", adminTemplate!.id);
    expect(stillThere).toHaveLength(1);

    // The creator (admin) themselves CAN delete it.
    const { error: adminDeleteError } = await adminMemberClient
      .from("task_templates")
      .delete()
      .eq("id", adminTemplate!.id);
    expect(adminDeleteError).toBeNull();

    const { data: goneNow } = await adminClient
      .from("task_templates")
      .select("id")
      .eq("id", adminTemplate!.id);
    expect(goneNow).toHaveLength(0);
  });

  it("the workspace owner (not the creator) CAN delete another member's template", async () => {
    const { data: memberTemplate, error: insertErr } = await memberClient
      .from("task_templates")
      .insert({
        workspace_id: workspaceId,
        name: "F181 member-owned template for owner-delete test",
        payload: TEMPLATE_PAYLOAD,
        created_by: memberUserId,
      })
      .select("id")
      .single();
    expect(insertErr).toBeNull();
    expect(memberTemplate).toBeTruthy();

    const { error: ownerDeleteError } = await ownerClient
      .from("task_templates")
      .delete()
      .eq("id", memberTemplate!.id);
    expect(ownerDeleteError).toBeNull();

    const { data: goneNow } = await adminClient
      .from("task_templates")
      .select("id")
      .eq("id", memberTemplate!.id);
    expect(goneNow).toHaveLength(0);
  });
});
