// Integration test for the Team PTO calendar feature -- run against the
// real linked Supabase project, mirroring the loadDotEnv/admin-client/
// mocked-`@/lib/supabase/server`-auth/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/calendar-blocks-crud.test.ts.
//
// Exercises the REAL Server Actions (lib/actions/time-off.ts) against the
// real database -- create/delete, ownership + admin-override enforcement,
// and cross-workspace-member read visibility (RLS), never a hand-built
// fixture and never a direct table write from the test itself for the
// behaviour under test.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "time-off: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    throw new Error("no active request/render context (expected in tests)");
  },
}));

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

async function createSessionClientForUser(email: string, password: string) {
  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to sign in test user: ${error.message}`);
  return client;
}

const sessionClients = new Map<string, SupabaseClient>();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (!currentTestUserId) {
      return { auth: { getUser: async () => ({ data: { user: null } }) } };
    }
    const real = sessionClients.get(currentTestUserId);
    if (real) return real;
    return { auth: { getUser: async () => ({ data: { user: null } }) } };
  },
}));

describe.skipIf(!haveAdminCreds)("Team PTO time_off_entries CRUD + RLS", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdEntryIds: string[] = [];

  let workspaceId: string;

  let memberUserId: string;
  let memberEmail: string;
  const memberPassword = "Test-password-1!";

  let otherMemberUserId: string;
  let otherEmail: string;

  let adminMemberUserId: string;
  let adminEmail: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "PTO Workspace", slug: `pto-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `pto-member-${uniqueSuffix}@example.com`;
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

    otherEmail = `pto-other-${uniqueSuffix}@example.com`;
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

    adminEmail = `pto-admin-${uniqueSuffix}@example.com`;
    const { data: adminAuth, error: adminErr } = await adminClient.auth.admin.createUser({
      email: adminEmail,
      password: memberPassword,
      email_confirm: true,
    });
    if (adminErr || !adminAuth.user) {
      throw new Error(`Failed to create admin user: ${adminErr?.message}`);
    }
    adminMemberUserId = adminAuth.user.id;
    createdUserIds.push(adminMemberUserId);

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: adminMemberUserId, role: "admin", status: "active" },
    ]);
    if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

    const memberClient = await createSessionClientForUser(memberEmail, memberPassword);
    const otherClient = await createSessionClientForUser(otherEmail, memberPassword);
    const adminMemberClient = await createSessionClientForUser(adminEmail, memberPassword);
    sessionClients.set(memberUserId, memberClient);
    sessionClients.set(otherMemberUserId, otherClient);
    sessionClients.set(adminMemberUserId, adminMemberClient);
  });

  afterAll(async () => {
    for (const id of createdEntryIds) {
      await adminClient.from("time_off_entries").delete().eq("id", id);
    }
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", id);
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("test_time_off_create_persists_a_real_row_owned_by_the_caller", async () => {
    currentTestUserId = memberUserId;
    const { createTimeOff } = await import("@/lib/actions/time-off");

    const result = await createTimeOff({
      workspaceId,
      startDate: "2026-05-01",
      endDate: "2026-05-05",
      note: "Godišnji odmor",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdEntryIds.push(result.data.id);
    expect(result.data.userId).toBe(memberUserId);

    const { data: row } = await adminClient
      .from("time_off_entries")
      .select("user_id, start_date, end_date, note")
      .eq("id", result.data.id)
      .single();
    expect(row?.user_id).toBe(memberUserId);
    expect(row?.note).toBe("Godišnji odmor");
  });

  it("test_time_off_create_rejects_end_date_before_start_date", async () => {
    currentTestUserId = memberUserId;
    const { createTimeOff } = await import("@/lib/actions/time-off");

    const result = await createTimeOff({
      workspaceId,
      startDate: "2026-05-10",
      endDate: "2026-05-05",
    });

    expect(result.ok).toBe(false);
  });

  it("test_time_off_a_fellow_active_workspace_member_can_see_someone_elses_pto_entry", async () => {
    currentTestUserId = memberUserId;
    const { createTimeOff } = await import("@/lib/actions/time-off");
    const created = await createTimeOff({
      workspaceId,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdEntryIds.push(created.data.id);

    // Read as a DIFFERENT active member -- team transparency (AS spec):
    // every active workspace member can see every PTO entry.
    const otherSessionClient = sessionClients.get(otherMemberUserId)!;
    const { data: visibleRows, error } = await otherSessionClient
      .from("time_off_entries")
      .select("id")
      .eq("id", created.data.id);

    expect(error).toBeNull();
    expect(visibleRows?.map((r) => r.id)).toContain(created.data.id);
  });

  it("test_time_off_owner_can_delete_their_own_entry", async () => {
    currentTestUserId = memberUserId;
    const { createTimeOff, deleteTimeOff } = await import("@/lib/actions/time-off");

    const created = await createTimeOff({
      workspaceId,
      startDate: "2026-06-10",
      endDate: "2026-06-11",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteTimeOff({ entryId: created.data.id });
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("time_off_entries")
      .select("id")
      .eq("id", created.data.id)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("test_time_off_a_regular_member_cannot_delete_someone_elses_entry", async () => {
    currentTestUserId = memberUserId;
    const { createTimeOff, deleteTimeOff } = await import("@/lib/actions/time-off");

    const created = await createTimeOff({
      workspaceId,
      startDate: "2026-06-15",
      endDate: "2026-06-16",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdEntryIds.push(created.data.id);

    currentTestUserId = otherMemberUserId;
    const result = await deleteTimeOff({ entryId: created.data.id });
    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("time_off_entries")
      .select("id")
      .eq("id", created.data.id)
      .maybeSingle();
    expect(row).not.toBeNull();
  });

  it("test_time_off_a_workspace_admin_can_delete_someone_elses_entry", async () => {
    currentTestUserId = memberUserId;
    const { createTimeOff, deleteTimeOff } = await import("@/lib/actions/time-off");

    const created = await createTimeOff({
      workspaceId,
      startDate: "2026-06-20",
      endDate: "2026-06-21",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    currentTestUserId = adminMemberUserId;
    const result = await deleteTimeOff({ entryId: created.data.id });
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("time_off_entries")
      .select("id")
      .eq("id", created.data.id)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("test_time_off_getTimeOffEntries_returns_only_entries_overlapping_the_requested_range", async () => {
    currentTestUserId = memberUserId;
    const { createTimeOff } = await import("@/lib/actions/time-off");
    const { getTimeOffEntries } = await import("@/lib/queries/time-off");

    const inRange = await createTimeOff({
      workspaceId,
      startDate: "2026-07-05",
      endDate: "2026-07-06",
    });
    const outOfRange = await createTimeOff({
      workspaceId,
      startDate: "2026-08-05",
      endDate: "2026-08-06",
    });
    expect(inRange.ok).toBe(true);
    expect(outOfRange.ok).toBe(true);
    if (!inRange.ok || !outOfRange.ok) return;
    createdEntryIds.push(inRange.data.id, outOfRange.data.id);

    const results = await getTimeOffEntries(workspaceId, "2026-07-01", "2026-08-01");
    const ids = results.map((e) => e.id);
    expect(ids).toContain(inRange.data.id);
    expect(ids).not.toContain(outOfRange.data.id);
  });
});
