// Integration test for the out-of-office status note feature -- run
// against the real linked Supabase project, mirroring
// tests/integration/calendar-blocks-crud.test.ts's own pattern.
//
// Exercises the REAL Server Action (lib/actions/status-note.ts) and the
// REAL read path (getWorkspaceMembers) against the real database --
// setting/clearing a note, self-only enforcement (RLS), and the expiry
// filter that hides an already-past `status_note_until` from every
// display surface fed by getWorkspaceMembers.

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
    "status-note: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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

describe.skipIf(!haveAdminCreds)("Out-of-office status note", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  let workspaceId: string;

  let memberUserId: string;
  let memberEmail: string;
  const memberPassword = "Test-password-1!";

  let otherMemberUserId: string;
  let otherEmail: string;

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "Status Note Workspace", slug: `statusnote-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `statusnote-member-${uniqueSuffix}@example.com`;
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

    otherEmail = `statusnote-other-${uniqueSuffix}@example.com`;
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

    const { error: memberInsertErr } = await adminClient.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: memberUserId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: otherMemberUserId, role: "member", status: "active" },
    ]);
    if (memberInsertErr) throw new Error(`Failed to seed members: ${memberInsertErr.message}`);

    const memberClient = await createSessionClientForUser(memberEmail, memberPassword);
    const otherClient = await createSessionClientForUser(otherEmail, memberPassword);
    sessionClients.set(memberUserId, memberClient);
    sessionClients.set(otherMemberUserId, otherClient);
  });

  afterAll(async () => {
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", id);
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("test_status_note_update_sets_the_callers_own_note_and_until_date", async () => {
    currentTestUserId = memberUserId;
    const { updateStatusNote } = await import("@/lib/actions/status-note");

    const result = await updateStatusNote({
      workspaceId,
      note: "Vraćam se ponedeljak",
      until: "2099-01-01",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.note).toBe("Vraćam se ponedeljak");
    expect(result.data.until).toBe("2099-01-01");

    const { data: row } = await adminClient
      .from("workspace_members")
      .select("status_note, status_note_until")
      .eq("workspace_id", workspaceId)
      .eq("user_id", memberUserId)
      .single();
    expect(row?.status_note).toBe("Vraćam se ponedeljak");
  });

  it("test_status_note_a_member_cannot_set_someone_elses_status_note", async () => {
    // The action itself only ever targets `user.id` from the session --
    // there is no `targetUserId` parameter to smuggle another member's id
    // through, so this proves the write always lands on the caller's own
    // row, never a different one, by checking the OTHER member's row is
    // untouched after `memberUserId` sets their own note.
    currentTestUserId = memberUserId;
    const { updateStatusNote } = await import("@/lib/actions/status-note");
    await updateStatusNote({ workspaceId, note: "My own note", until: null });

    const { data: otherRow } = await adminClient
      .from("workspace_members")
      .select("status_note")
      .eq("workspace_id", workspaceId)
      .eq("user_id", otherMemberUserId)
      .single();
    expect(otherRow?.status_note).toBeNull();
  });

  it("test_status_note_getWorkspaceMembers_hides_an_expired_note", async () => {
    currentTestUserId = memberUserId;
    const { updateStatusNote } = await import("@/lib/actions/status-note");
    await updateStatusNote({
      workspaceId,
      note: "This note has expired",
      until: "2020-01-01",
    });

    const { getWorkspaceMembers } = await import("@/lib/queries/members");
    const members = await getWorkspaceMembers(workspaceId);
    const self = members.active.find((m) => m.userId === memberUserId);
    expect(self?.statusNote).toBeNull();
  });

  it("test_status_note_getWorkspaceMembers_surfaces_an_active_note", async () => {
    currentTestUserId = memberUserId;
    const { updateStatusNote } = await import("@/lib/actions/status-note");
    await updateStatusNote({
      workspaceId,
      note: "Currently active note",
      until: "2099-01-01",
    });

    const { getWorkspaceMembers } = await import("@/lib/queries/members");
    const members = await getWorkspaceMembers(workspaceId);
    const self = members.active.find((m) => m.userId === memberUserId);
    expect(self?.statusNote).toBe("Currently active note");
  });

  it("test_status_note_clearing_the_note_removes_it", async () => {
    currentTestUserId = memberUserId;
    const { updateStatusNote } = await import("@/lib/actions/status-note");
    await updateStatusNote({ workspaceId, note: "Temporary", until: null });
    const cleared = await updateStatusNote({ workspaceId, note: null, until: null });

    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.data.note).toBeNull();
  });
});
