// Integration test for the Planner calendar_blocks feature -- run against
// the real linked Supabase project, mirroring the loadDotEnv/admin-client/
// mocked-`@/lib/supabase/server`-auth/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/f234-calendar-drag-reschedule.test.ts.
//
// Exercises the REAL Server Actions (lib/actions/calendar-blocks.ts)
// against the real database -- create/update/delete, ownership
// enforcement, and workspace/project visibility, never a hand-built
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
    "calendar-blocks: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let currentTestUserId: string | null = null;

vi.mock("next/cache", () => ({
  revalidatePath: () => {
    // Matches f234's own convention: no active request/render context in
    // a test, and revalidateCalendarRoutes already swallows this.
    throw new Error("no active request/render context (expected in tests)");
  },
}));

// The session-scoped client used for the "real write" path (RLS-enforced)
// -- built with the anon/publishable key so RLS actually applies, auth
// spoofed via `auth.getUser()` the same way f234's suite does, and every
// `.from(...)` call re-signed with the currently "logged in" user via
// Postgres role switching isn't available here, so instead we use the
// admin client impersonated through the same trick f234 relies on: since
// RLS can't be exercised without a real JWT, this suite creates a REAL
// session for each user via password sign-in and uses that authenticated
// client for the mocked `createClient()` -- proving the actual RLS
// policies, not just the action's own app-layer checks.
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
    // Fallback: no real session registered for this id -- getUser()
    // returns null, actions correctly reject as unauthenticated.
    return { auth: { getUser: async () => ({ data: { user: null } }) } };
  },
}));

describe.skipIf(!haveAdminCreds)("Planner calendar_blocks CRUD + RLS", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdProjectIds: string[] = [];
  const createdBlockIds: string[] = [];

  let workspaceId: string;
  let visibleProjectId: string;
  let privateProjectId: string;

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
      .insert({ name: "Blocks Workspace", slug: `calblocks-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    workspaceId = ws.id;
    createdWorkspaceIds.push(workspaceId);

    memberEmail = `calblocks-member-${uniqueSuffix}@example.com`;
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

    otherEmail = `calblocks-other-${uniqueSuffix}@example.com`;
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

    const { data: visibleProject, error: visibleErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "Blocks Visible Project", visibility: "workspace" })
      .select("id")
      .single();
    if (visibleErr || !visibleProject) {
      throw new Error(`Failed to seed visible project: ${visibleErr?.message}`);
    }
    visibleProjectId = visibleProject.id;
    createdProjectIds.push(visibleProjectId);

    const { data: privateProject, error: privateErr } = await adminClient
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "Blocks Private Project", visibility: "private" })
      .select("id")
      .single();
    if (privateErr || !privateProject) {
      throw new Error(`Failed to seed private project: ${privateErr?.message}`);
    }
    privateProjectId = privateProject.id;
    createdProjectIds.push(privateProjectId);
    // memberUserId is NOT a member of the private project -- otherMemberUserId is.
    await adminClient.from("project_members").insert({
      project_id: privateProjectId,
      user_id: otherMemberUserId,
    });

    const memberClient = await createSessionClientForUser(memberEmail, memberPassword);
    const otherClient = await createSessionClientForUser(otherEmail, memberPassword);
    sessionClients.set(memberUserId, memberClient);
    sessionClients.set(otherMemberUserId, otherClient);
  });

  afterAll(async () => {
    for (const id of createdBlockIds) {
      await adminClient.from("calendar_blocks").delete().eq("id", id);
    }
    for (const id of createdProjectIds) {
      await adminClient.from("project_members").delete().eq("project_id", id);
      await adminClient.from("projects").delete().eq("id", id);
    }
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", id);
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("test_calendar_blocks_create_persists_a_real_row_with_the_caller_as_owner", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock } = await import("@/lib/actions/calendar-blocks");

    const result = await createCalendarBlock({
      workspaceId,
      title: "Morning meeting",
      startsAt: "2026-04-01T08:05:00.000Z",
      endsAt: "2026-04-01T08:35:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdBlockIds.push(result.data.id);
    expect(result.data.userId).toBe(memberUserId);
    expect(result.data.title).toBe("Morning meeting");

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("title, user_id, workspace_id")
      .eq("id", result.data.id)
      .single();
    expect(row?.title).toBe("Morning meeting");
    expect(row?.user_id).toBe(memberUserId);
  });

  it("test_calendar_blocks_create_rejects_end_before_start", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock } = await import("@/lib/actions/calendar-blocks");

    const result = await createCalendarBlock({
      workspaceId,
      title: "Bad range",
      startsAt: "2026-04-01T10:00:00.000Z",
      endsAt: "2026-04-01T09:00:00.000Z",
    });

    expect(result.ok).toBe(false);
  });

  it("test_calendar_blocks_create_rejects_a_project_the_caller_cannot_see", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock } = await import("@/lib/actions/calendar-blocks");

    const result = await createCalendarBlock({
      workspaceId,
      projectId: privateProjectId,
      title: "Should fail",
      startsAt: "2026-04-01T08:00:00.000Z",
      endsAt: "2026-04-01T09:00:00.000Z",
    });

    expect(result.ok).toBe(false);
  });

  it("test_calendar_blocks_owner_can_update_their_own_block_move_and_resize", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock, updateCalendarBlock } = await import(
      "@/lib/actions/calendar-blocks"
    );

    const created = await createCalendarBlock({
      workspaceId,
      title: "Stenmagasinet",
      startsAt: "2026-04-02T10:00:00.000Z",
      endsAt: "2026-04-02T14:30:00.000Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdBlockIds.push(created.data.id);

    const updated = await updateCalendarBlock({
      blockId: created.data.id,
      title: "Stenmagasinet (renamed)",
      startsAt: "2026-04-03T09:00:00.000Z",
      endsAt: "2026-04-03T13:00:00.000Z",
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.title).toBe("Stenmagasinet (renamed)");
    expect(updated.data.startsAt).toBe("2026-04-03T09:00:00+00:00");
  });

  it("test_calendar_blocks_a_different_workspace_member_cannot_update_someone_elses_block", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock, updateCalendarBlock } = await import(
      "@/lib/actions/calendar-blocks"
    );

    const created = await createCalendarBlock({
      workspaceId,
      title: "Owned by member",
      startsAt: "2026-04-04T08:00:00.000Z",
      endsAt: "2026-04-04T09:00:00.000Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdBlockIds.push(created.data.id);

    currentTestUserId = otherMemberUserId;
    const result = await updateCalendarBlock({
      blockId: created.data.id,
      title: "Hijacked",
    });

    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("title")
      .eq("id", created.data.id)
      .single();
    expect(row?.title).toBe("Owned by member");
  });

  it("test_calendar_blocks_owner_can_delete_their_own_block", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock, deleteCalendarBlock } = await import(
      "@/lib/actions/calendar-blocks"
    );

    const created = await createCalendarBlock({
      workspaceId,
      title: "To be deleted",
      startsAt: "2026-04-05T08:00:00.000Z",
      endsAt: "2026-04-05T09:00:00.000Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const result = await deleteCalendarBlock({ blockId: created.data.id });
    expect(result.ok).toBe(true);

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("id")
      .eq("id", created.data.id)
      .maybeSingle();
    expect(row).toBeNull();
  });

  it("test_calendar_blocks_a_different_workspace_member_cannot_delete_someone_elses_block", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock, deleteCalendarBlock } = await import(
      "@/lib/actions/calendar-blocks"
    );

    const created = await createCalendarBlock({
      workspaceId,
      title: "Protected from deletion",
      startsAt: "2026-04-06T08:00:00.000Z",
      endsAt: "2026-04-06T09:00:00.000Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdBlockIds.push(created.data.id);

    currentTestUserId = otherMemberUserId;
    const result = await deleteCalendarBlock({ blockId: created.data.id });
    expect(result.ok).toBe(false);

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("id")
      .eq("id", created.data.id)
      .maybeSingle();
    expect(row).not.toBeNull();
  });

  it("test_calendar_blocks_getCalendarBlocks_returns_only_blocks_overlapping_the_requested_range", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock } = await import("@/lib/actions/calendar-blocks");
    const { getCalendarBlocks } = await import("@/lib/queries/calendar-blocks");

    const inRange = await createCalendarBlock({
      workspaceId,
      title: "In range",
      startsAt: "2026-05-10T08:00:00.000Z",
      endsAt: "2026-05-10T09:00:00.000Z",
    });
    const outOfRange = await createCalendarBlock({
      workspaceId,
      title: "Out of range",
      startsAt: "2026-06-10T08:00:00.000Z",
      endsAt: "2026-06-10T09:00:00.000Z",
    });
    expect(inRange.ok).toBe(true);
    expect(outOfRange.ok).toBe(true);
    if (!inRange.ok || !outOfRange.ok) return;
    createdBlockIds.push(inRange.data.id, outOfRange.data.id);

    const results = await getCalendarBlocks(
      workspaceId,
      "2026-05-01T00:00:00.000Z",
      "2026-06-01T00:00:00.000Z",
      [memberUserId],
    );

    const ids = results.map((b) => b.id);
    expect(ids).toContain(inRange.data.id);
    expect(ids).not.toContain(outOfRange.data.id);
  });

  // Client Presentation feature (supabase/migrations/
  // 20261112010000_calendar_block_client_presentation.sql): block_type
  // defaults to 'general' and round-trips through create/update exactly
  // like every other column this action already covers.
  it("test_calendar_blocks_block_type_defaults_to_general_when_not_specified", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock } = await import("@/lib/actions/calendar-blocks");

    const created = await createCalendarBlock({
      workspaceId,
      title: "Ordinary block",
      startsAt: "2026-04-07T08:00:00.000Z",
      endsAt: "2026-04-07T09:00:00.000Z",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdBlockIds.push(created.data.id);
    expect(created.data.blockType).toBe("general");
  });

  it("test_calendar_blocks_can_be_created_and_updated_as_a_client_presentation", async () => {
    currentTestUserId = memberUserId;
    const { createCalendarBlock, updateCalendarBlock } = await import(
      "@/lib/actions/calendar-blocks"
    );

    const created = await createCalendarBlock({
      workspaceId,
      title: "Client call",
      startsAt: "2026-04-08T08:00:00.000Z",
      endsAt: "2026-04-08T09:00:00.000Z",
      blockType: "client_presentation",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdBlockIds.push(created.data.id);
    expect(created.data.blockType).toBe("client_presentation");

    const updated = await updateCalendarBlock({
      blockId: created.data.id,
      blockType: "general",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.blockType).toBe("general");
  });
});
