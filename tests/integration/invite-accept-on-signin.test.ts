// Integration test for F016 (AS-008, AS-009) — mirrors the loadDotEnv/skipIf
// admin-client pattern established by tests/integration/invite-member.test.ts.
//
// Exercises activateInvitedMemberships directly (the function the auth
// callback route calls right after establishing a session), since driving
// the real magic-link/OAuth callback route end-to-end would require a live
// browser session Supabase won't issue in a test environment.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)("activateInvitedMemberships (F016: AS-008, AS-009)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(() => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  afterAll(async () => {
    for (const workspaceId of createdWorkspaceIds) {
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  async function createWorkspace(prefix: string) {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: workspace, error } = await adminClient
      .from("workspaces")
      .insert({ name: `F016 test ${prefix}`, slug: `f016-${prefix}-${uniqueSuffix}` })
      .select("id")
      .single();
    if (error || !workspace) {
      throw new Error(`Failed to create test workspace: ${error?.message}`);
    }
    createdWorkspaceIds.push(workspace.id);
    return workspace.id as string;
  }

  async function createThrowawayUser(prefix: string) {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `f016-${prefix}-${uniqueSuffix}@example.com`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: "Test-password-1!",
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create test user: ${error?.message}`);
    }
    createdUserIds.push(data.user.id);
    return { userId: data.user.id, email };
  }

  async function seedInvite(workspaceId: string, invitedEmail: string) {
    const { error } = await adminClient.from("workspace_members").insert({
      workspace_id: workspaceId,
      invited_email: invitedEmail,
      status: "invited",
      role: "member",
    });
    if (error) {
      throw new Error(`Failed to seed invite: ${error.message}`);
    }
  }

  it("AS-008: an invited email that signs in is granted active membership, no separate signup token", async () => {
    const { activateInvitedMemberships } = await import("@/lib/actions/invites");
    const workspaceId = await createWorkspace("as008");
    const invitedEmail = `f016-invitee-${Date.now()}@example.com`;
    await seedInvite(workspaceId, invitedEmail);

    const { userId } = await createThrowawayUser("signer");

    const activated = await activateInvitedMemberships(userId, invitedEmail);

    expect(activated).toEqual([{ workspaceId }]);

    const { data: row, error } = await adminClient
      .from("workspace_members")
      .select("status, user_id, invited_email")
      .eq("workspace_id", workspaceId)
      .eq("invited_email", invitedEmail)
      .single();

    expect(error).toBeNull();
    expect(row!.status).toBe("active");
    expect(row!.user_id).toBe(userId);
    // invited_email is deliberately left in place as an audit trail.
    expect(row!.invited_email).toBe(invitedEmail);
  });

  it("AS-008: a user invited to multiple workspaces gets all matching rows activated", async () => {
    const { activateInvitedMemberships } = await import("@/lib/actions/invites");
    const workspaceA = await createWorkspace("multi-a");
    const workspaceB = await createWorkspace("multi-b");
    const invitedEmail = `f016-multi-invitee-${Date.now()}@example.com`;
    await seedInvite(workspaceA, invitedEmail);
    await seedInvite(workspaceB, invitedEmail);

    const { userId } = await createThrowawayUser("multi-signer");

    const activated = await activateInvitedMemberships(userId, invitedEmail);

    expect(activated).toHaveLength(2);
    const activatedIds = activated.map((a) => a.workspaceId).sort();
    expect(activatedIds).toEqual([workspaceA, workspaceB].sort());

    const { data: rows } = await adminClient
      .from("workspace_members")
      .select("workspace_id, status, user_id")
      .eq("invited_email", invitedEmail);

    expect(rows).toHaveLength(2);
    for (const row of rows!) {
      expect(row.status).toBe("active");
      expect(row.user_id).toBe(userId);
    }
  });

  it("AS-009 (failure case): a not-yet-invited user's sign-in does not activate anything", async () => {
    const { activateInvitedMemberships } = await import("@/lib/actions/invites");
    const workspaceId = await createWorkspace("as009-unrelated");
    const invitedEmail = `f016-real-invitee-${Date.now()}@example.com`;
    await seedInvite(workspaceId, invitedEmail);

    const { userId } = await createThrowawayUser("stranger");
    const strangerEmail = `f016-stranger-${Date.now()}@example.com`;

    const activated = await activateInvitedMemberships(userId, strangerEmail);

    expect(activated).toEqual([]);

    // The unrelated invite row must remain untouched: still invited, no
    // user_id claimed by the stranger (AS-009: not-yet-signed-in invite
    // must not appear active).
    const { data: row } = await adminClient
      .from("workspace_members")
      .select("status, user_id")
      .eq("workspace_id", workspaceId)
      .eq("invited_email", invitedEmail)
      .single();

    expect(row!.status).toBe("invited");
    expect(row!.user_id).toBeNull();
  });

  it("AS-009: calling activation twice (simulated concurrent duplicate) only claims the row once", async () => {
    const { activateInvitedMemberships } = await import("@/lib/actions/invites");
    const workspaceId = await createWorkspace("as009-race");
    const invitedEmail = `f016-race-invitee-${Date.now()}@example.com`;
    await seedInvite(workspaceId, invitedEmail);

    const { userId: firstUserId } = await createThrowawayUser("race-first");

    const [firstResult, secondResult] = await Promise.all([
      activateInvitedMemberships(firstUserId, invitedEmail),
      activateInvitedMemberships(firstUserId, invitedEmail),
    ]);

    // Exactly one of the two concurrent calls should have claimed the row;
    // the other finds it already claimed (user_id no longer null) and
    // activates nothing.
    const totalActivated = firstResult.length + secondResult.length;
    expect(totalActivated).toBe(1);

    const { data: rows } = await adminClient
      .from("workspace_members")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("user_id", firstUserId);

    expect(rows).toHaveLength(1);
  });
});
