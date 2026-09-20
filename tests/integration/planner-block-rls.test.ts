// Integration test for F011: RLS coverage proving F010's calendar_blocks
// widening (supabase/migrations/20260920113500_calendar_blocks_workspace_wide_select.sql,
// 20260920113501_calendar_blocks_drop_task_id.sql) only widened SELECT to
// "any active workspace member" and left writes (UPDATE/DELETE) gated to
// the block's own owner (auth.uid() = user_id), mirroring the
// loadDotEnv/admin-client/session-client pattern established by
// tests/integration/calendar-blocks-crud.test.ts.
//
// AS-028: someone who is not an active member of the workspace cannot
// read any of its calendar blocks.
// AS-032: a member cannot insert, update, or delete a calendar block
// owned by another member; the database rejects the write.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "planner-block-rls: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) as GitHub Actions repository secrets.",
  );
}

async function createSessionClientForUser(email: string, password: string) {
  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to sign in test user: ${error.message}`);
  return client;
}

describe.skipIf(!haveAdminCreds)("Planner calendar_blocks RLS (F011)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdBlockIds: string[] = [];

  let workspaceId: string;

  let memberUserId: string;
  let memberEmail: string;
  const memberPassword = "Test-password-1!";
  let memberClient: SupabaseClient;

  let otherMemberUserId: string;
  let otherEmail: string;
  let otherClient: SupabaseClient;

  // Not a member of the workspace at all.
  let nonMemberEmail: string;
  let nonMemberUserId: string;
  let nonMemberClient: SupabaseClient;

  let memberBlockId: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "Block RLS Workspace", slug: `blockrls-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `blockrls-member-${uniqueSuffix}@example.com`;
    const { data: memberAuth, error: memberErr } = await adminClient.auth.admin.createUser({
      email: memberEmail,
      password: memberPassword,
      email_confirm: true,
    });
    if (memberErr || !memberAuth.user) {
      throw new Error(`Failed to create member user: ${memberErr?.message}`);
    }
    memberUserId = memberAuth.user.id;
    createdUserIds.push(memberUserId);

    otherEmail = `blockrls-other-${uniqueSuffix}@example.com`;
    const { data: otherAuth, error: otherErr } = await adminClient.auth.admin.createUser({
      email: otherEmail,
      password: memberPassword,
      email_confirm: true,
    });
    if (otherErr || !otherAuth.user) {
      throw new Error(`Failed to create second member user: ${otherErr?.message}`);
    }
    otherMemberUserId = otherAuth.user.id;
    createdUserIds.push(otherMemberUserId);

    nonMemberEmail = `blockrls-nonmember-${uniqueSuffix}@example.com`;
    const { data: nonMemberAuth, error: nonMemberErr } = await adminClient.auth.admin.createUser({
      email: nonMemberEmail,
      password: memberPassword,
      email_confirm: true,
    });
    if (nonMemberErr || !nonMemberAuth.user) {
      throw new Error(`Failed to create non-member user: ${nonMemberErr?.message}`);
    }
    nonMemberUserId = nonMemberAuth.user.id;
    createdUserIds.push(nonMemberUserId);

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
      // nonMemberUserId is deliberately NOT inserted into workspace_members.
    ]);
    if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

    memberClient = await createSessionClientForUser(memberEmail, memberPassword);
    otherClient = await createSessionClientForUser(otherEmail, memberPassword);
    nonMemberClient = await createSessionClientForUser(nonMemberEmail, memberPassword);

    // Seed a real block owned by `memberUserId` via the member's own
    // authenticated session (RLS-enforced insert, not an admin bypass).
    const { data: block, error: blockErr } = await memberClient
      .from("calendar_blocks")
      .insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        title: "Owned by member",
        starts_at: "2026-09-21T08:00:00.000Z",
        ends_at: "2026-09-21T09:00:00.000Z",
      })
      .select("id")
      .single();
    if (blockErr || !block) throw new Error(`Failed to seed block: ${blockErr?.message}`);
    memberBlockId = block.id;
    createdBlockIds.push(memberBlockId);
  });

  afterAll(async () => {
    for (const id of createdBlockIds) {
      await adminClient.from("calendar_blocks").delete().eq("id", id);
    }
    await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("test_AS_028_active_workspace_member_can_read_another_members_block", async () => {
    // Sanity check establishing the baseline the negative case below is
    // contrasted against: F010 widened SELECT to any active workspace
    // member, so `otherClient` (an active member, not the block's owner)
    // must be able to read it.
    const { data, error } = await otherClient
      .from("calendar_blocks")
      .select("id, title")
      .eq("id", memberBlockId);

    expect(error).toBeNull();
    expect(data?.map((row) => row.id)).toContain(memberBlockId);
  });

  it("test_AS_028_non_member_cannot_read_any_workspace_blocks", async () => {
    const { data, error } = await nonMemberClient
      .from("calendar_blocks")
      .select("id, title")
      .eq("workspace_id", workspaceId);

    // RLS filters all rows for a non-member; no error is expected -- the
    // select succeeds but returns zero rows (this repo's established "no
    // matching policy => empty result set" convention, matching
    // calendar_blocks_select_visible's own is_active_workspace_member gate).
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("test_AS_028_unauthenticated_anon_client_reads_zero_rows_for_the_workspace", async () => {
    // No policy exists for the `anon` role on calendar_blocks (per this
    // migration's own comment: "No policy for anon: absence of a matching
    // policy denies access by default under RLS"). An anon client (no
    // signed-in session at all) must read nothing.
    const anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await anonClient
      .from("calendar_blocks")
      .select("id, title")
      .eq("workspace_id", workspaceId);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("test_AS_032_active_member_cannot_update_another_members_block", async () => {
    const { data, error } = await otherClient
      .from("calendar_blocks")
      .update({ title: "Hijacked by otherClient" })
      .eq("id", memberBlockId)
      .select("id");

    // RLS's `using (user_id = auth.uid())` clause on
    // calendar_blocks_update_own filters the target row before the write
    // applies -- no error, but zero rows are affected/returned.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("title")
      .eq("id", memberBlockId)
      .single();
    expect(row?.title).toBe("Owned by member");
  });

  it("test_AS_032_active_member_cannot_delete_another_members_block", async () => {
    const { data, error } = await otherClient
      .from("calendar_blocks")
      .delete()
      .eq("id", memberBlockId)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("id")
      .eq("id", memberBlockId)
      .maybeSingle();
    expect(row).not.toBeNull();
  });

  it("test_AS_032_active_member_cannot_insert_a_block_owned_by_another_member", async () => {
    // calendar_blocks_insert_visible's `with check (user_id = auth.uid()
    // and ...)` rejects any insert where the caller sets `user_id` to
    // someone else -- proving insert is owner-only too, not just
    // update/delete.
    const { error } = await otherClient.from("calendar_blocks").insert({
      workspace_id: workspaceId,
      user_id: memberUserId,
      title: "Forged ownership",
      starts_at: "2026-09-22T08:00:00.000Z",
      ends_at: "2026-09-22T09:00:00.000Z",
    });

    expect(error).not.toBeNull();
  });

  it("test_AS_032_admin_bypass_confirms_the_row_exists_and_RLS_not_a_missing_row_is_what_blocked_the_write", async () => {
    // Corroborates the two tests above at the policy-definition level:
    // calendar_blocks_update_own / calendar_blocks_delete_own both `using
    // (user_id = auth.uid())` per
    // supabase/migrations/20261107010000_calendar_blocks.sql -- F010's
    // migrations (20260920113500/20260920113501) only touched the SELECT
    // policy and the task_id column, never these write policies. An
    // admin-key client (RLS bypass) can still update the row otherClient
    // failed to touch, proving the row was reachable and RLS -- not a
    // missing/mismatched id -- is what rejected otherClient's write.
    const { data: adminUpdate, error: adminErr } = await adminClient
      .from("calendar_blocks")
      .update({ title: "Owned by member" })
      .eq("id", memberBlockId)
      .select("id");
    expect(adminErr).toBeNull();
    expect(adminUpdate).toHaveLength(1);
  });
});
