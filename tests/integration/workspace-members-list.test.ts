// Integration test for F017 (AS-023), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf and server-client
// mocking pattern established by tests/integration/invite-member.test.ts.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(
  SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY,
);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// The mocked `createClient` must actually go through RLS as the caller
// (not just report the right `auth.getUser()` id) for the isolation test
// below to mean anything, so — mirroring
// tests/integration/rls-workspaces.test.ts — it hands back a real
// publishable-key client that has signed in as the test user via
// `signInWithPassword`, rather than an admin client with a faked identity.
let currentSignedInClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSignedInClient,
}));

describe.skipIf(!haveAdminCreds)("getWorkspaceMembers (F017: AS-023)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];

  beforeAll(() => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  beforeEach(() => {
    currentSignedInClient = null;
  });

  afterAll(async () => {
    for (const workspaceId of createdWorkspaceIds) {
      await adminClient
        .from("workspace_members")
        .delete()
        .eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
    for (const userId of createdUserIds) {
      await adminClient.auth.admin.deleteUser(userId);
    }
  });

  const TEST_PASSWORD = "Test-password-1!";

  async function createThrowawayUser(prefix: string) {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `f017-${prefix}-${uniqueSuffix}@example.com`;
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Failed to create test user: ${error?.message}`);
    }
    createdUserIds.push(data.user.id);
    return { userId: data.user.id, email };
  }

  // Signs the given test user in with a real publishable-key client, and
  // makes that the client the mocked `createClient` (used by
  // getWorkspaceMembers) hands back — so RLS is genuinely evaluated as
  // that user, not simulated.
  async function signInAs(email: string) {
    const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error } = await client.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    if (error) {
      throw new Error(`Failed to sign in test user ${email}: ${error.message}`);
    }
    currentSignedInClient = client;
  }

  async function createWorkspace() {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: workspace, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({
        name: `F017 test ${uniqueSuffix}`,
        slug: `f017-${uniqueSuffix}`,
      })
      .select("id")
      .single();
    if (wsErr || !workspace) {
      throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
    }
    createdWorkspaceIds.push(workspace.id);
    return workspace.id as string;
  }

  it("AS-023: separates active members from pending invites", async () => {
    const { getWorkspaceMembers } = await import("@/lib/queries/members");
    const workspaceId = await createWorkspace();

    const owner = await createThrowawayUser("owner");

    const { error: ownerInsertError } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: owner.userId,
        role: "owner",
        status: "active",
      });
    expect(ownerInsertError).toBeNull();

    const invitedEmail = `f017-invitee-${Date.now()}@example.com`;
    const { error: inviteInsertError } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: null,
        invited_email: invitedEmail,
        role: "member",
        status: "invited",
      });
    expect(inviteInsertError).toBeNull();

    await signInAs(owner.email);
    const result = await getWorkspaceMembers(workspaceId);

    expect(result.active).toHaveLength(1);
    expect(result.active[0].userId).toBe(owner.userId);
    expect(result.active[0].role).toBe("owner");
    expect(result.active[0].email).toBe(owner.email);

    expect(result.pending).toHaveLength(1);
    expect(result.pending[0].invitedEmail).toBe(invitedEmail);
    expect(result.pending[0].role).toBe("member");

    // AS-023 (side-effect scope): pending invites never leak into the
    // active list and vice versa.
    expect(result.active.some((m) => m.email === invitedEmail)).toBe(false);
    expect(
      result.pending.some((p) => p.invitedEmail === owner.email),
    ).toBe(false);
  });

  it("AS-023 (failure/isolation case): a member of workspace A does not see workspace B's members or invites", async () => {
    const { getWorkspaceMembers } = await import("@/lib/queries/members");

    const workspaceA = await createWorkspace();
    const workspaceB = await createWorkspace();

    const ownerA = await createThrowawayUser("owner-a");
    const ownerB = await createThrowawayUser("owner-b");

    await adminClient.from("workspace_members").insert([
      {
        workspace_id: workspaceA,
        user_id: ownerA.userId,
        role: "owner",
        status: "active",
      },
      {
        workspace_id: workspaceB,
        user_id: ownerB.userId,
        role: "owner",
        status: "active",
      },
    ]);

    const invitedEmailB = `f017-invitee-b-${Date.now()}@example.com`;
    await adminClient.from("workspace_members").insert({
      workspace_id: workspaceB,
      user_id: null,
      invited_email: invitedEmailB,
      role: "member",
      status: "invited",
    });

    // Caller is a member of workspace A only, requesting workspace B's
    // members. RLS (`workspace_members_select_fellow_members`) should
    // return nothing for a workspace the caller doesn't belong to.
    await signInAs(ownerA.email);
    const result = await getWorkspaceMembers(workspaceB);

    expect(result.active).toHaveLength(0);
    expect(result.pending).toHaveLength(0);
  });
});
