// Integration test for F013 (AS-005, AS-006) and its F095 hardening
// follow-up, run against the real linked Supabase project — mirrors the
// loadDotEnv/skipIf pattern established by tests/integration/rls-workspaces.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked to stand in for the
// Next.js request-scoped server client (which needs `next/headers`'s
// `cookies()`, only available inside a real request). The mock's
// `auth.getUser()` resolves to a real throwaway Supabase Auth user, and —
// since F095 — its `rpc()` delegates to a *real*, signed-in (password
// auth) publishable-key client for that same user. That's required because
// `create_workspace_with_owner` (the SECURITY DEFINER RPC `createWorkspace`
// now calls) reads the owner id from Postgres's `auth.uid()`, which only
// resolves from a real JWT/session — a fabricated user id string is not
// enough. So this test proves AS-006 end-to-end against the real RPC, RLS,
// and grants, not a mock of the database layer.

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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);

let currentTestUserId: string | null = null;
let currentSignedInClient: SupabaseClient | null = null;

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: {
          user: currentTestUserId ? { id: currentTestUserId } : null,
        },
      }),
    },
    // F095: createWorkspace now calls supabase.rpc(...) on the *user's own
    // session* client (create_workspace_with_owner needs a real auth.uid()).
    // Delegate to a real, signed-in publishable-key client for the current
    // test user so the RPC actually authenticates as them.
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (!currentSignedInClient) {
        return {
          data: null,
          error: { message: "no signed-in test session" },
        };
      }
      return currentSignedInClient.rpc(fn, args);
    },
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "createWorkspace (F013: AS-005, AS-006; F095 hardening)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];

    beforeAll(() => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
    });

    beforeEach(() => {
      currentTestUserId = null;
      currentSignedInClient = null;
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

    // Creates a throwaway user AND signs them into a real publishable-key
    // client, since F095's RPC path needs a real session (auth.uid()), not
    // just a fabricated user id.
    async function createThrowawaySignedInUser() {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `f013-owner-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";
      const { data, error } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Failed to create test user: ${error?.message}`);
      }
      createdUserIds.push(data.user.id);

      const signedInClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInError } = await signedInClient.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) {
        throw new Error(`Failed to sign in test user: ${signInError.message}`);
      }

      return { userId: data.user.id, signedInClient };
    }

    it("AS-006: creating a workspace makes the creating user its owner (active)", async () => {
      const { createWorkspace } = await import("@/lib/actions/workspaces");

      const { userId, signedInClient } = await createThrowawaySignedInUser();
      currentTestUserId = userId;
      currentSignedInClient = signedInClient;

      const uniqueName = `F013 Owner Test ${Date.now()}`;
      const formData = new FormData();
      formData.set("name", uniqueName);

      let redirectedTo: string | null = null;
      try {
        await createWorkspace(null, formData);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.startsWith("NEXT_REDIRECT:")) throw err;
        redirectedTo = message.replace("NEXT_REDIRECT:", "");
      }

      expect(redirectedTo).not.toBeNull();
      expect(redirectedTo).toMatch(/^\/w\//);
      const slug = redirectedTo!.replace("/w/", "");

      const { data: workspace, error: workspaceError } = await adminClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", slug)
        .single();

      expect(workspaceError).toBeNull();
      expect(workspace).toBeTruthy();
      expect(workspace!.name).toBe(uniqueName);
      createdWorkspaceIds.push(workspace!.id);

      const { data: membership, error: membershipError } = await adminClient
        .from("workspace_members")
        .select("role, status, user_id, workspace_id")
        .eq("workspace_id", workspace!.id)
        .eq("user_id", userId)
        .single();

      expect(membershipError).toBeNull();
      expect(membership).toBeTruthy();
      expect(membership!.role).toBe("owner");
      expect(membership!.status).toBe("active");
    });

    it("AS-006: a second workspace created with a colliding name gets a distinct, unique slug", async () => {
      const { createWorkspace } = await import("@/lib/actions/workspaces");

      const { userId, signedInClient } = await createThrowawaySignedInUser();
      currentTestUserId = userId;
      currentSignedInClient = signedInClient;

      const sharedName = `F013 Collision ${Date.now()}`;

      async function createAndCaptureSlug(): Promise<string> {
        const formData = new FormData();
        formData.set("name", sharedName);
        try {
          await createWorkspace(null, formData);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!message.startsWith("NEXT_REDIRECT:")) throw err;
          return message.replace("NEXT_REDIRECT:", "").replace("/w/", "");
        }
        throw new Error("createWorkspace did not redirect");
      }

      const firstSlug = await createAndCaptureSlug();
      const secondSlug = await createAndCaptureSlug();

      expect(firstSlug).not.toBe(secondSlug);
      expect(secondSlug).toBe(`${firstSlug}-2`);

      const { data: workspaces } = await adminClient
        .from("workspaces")
        .select("id, slug")
        .in("slug", [firstSlug, secondSlug]);

      for (const ws of workspaces ?? []) {
        createdWorkspaceIds.push(ws.id);
      }
    });

    it("AS-006 (failure case): an unauthenticated caller cannot create a workspace or an owner membership", async () => {
      const { createWorkspace } = await import("@/lib/actions/workspaces");

      currentTestUserId = null;
      currentSignedInClient = null;

      const formData = new FormData();
      formData.set("name", `F013 No Auth ${Date.now()}`);

      const result = await createWorkspace(null, formData);

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to create a workspace.",
      });
    });

    // --- F095 hardening: prove the RPC is the *only* path, and that it's atomic ---

    it("F095/AS-006: a signed-in authenticated user's bare direct INSERT on workspaces is rejected (RLS bypass is closed)", async () => {
      const { userId, signedInClient } = await createThrowawaySignedInUser();
      currentTestUserId = userId;
      currentSignedInClient = signedInClient;

      // This is exactly the bypass scrutiny found: before F095, any
      // authenticated client could insert a workspaces row directly,
      // orphaning it forever since workspace_members has no INSERT policy
      // for `authenticated`. After F095's migration (revoked INSERT grant +
      // dropped `with check (true)` policy), this must fail.
      const { data, error } = await signedInClient
        .from("workspaces")
        .insert({ name: "Should never be created", slug: `f095-bypass-${Date.now()}` })
        .select("id")
        .single();

      expect(data).toBeNull();
      expect(error).toBeTruthy();

      // Confirm nothing was left behind (belt-and-suspenders on top of the
      // insert itself failing).
      const { data: leaked } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("name", "Should never be created");
      expect(leaked ?? []).toHaveLength(0);
    });

    it("F095/AS-006: create_workspace_with_owner is atomic — a duplicate slug fails the whole RPC, leaving no partial workspace row", async () => {
      const { userId: firstUserId, signedInClient: firstSignedInClient } =
        await createThrowawaySignedInUser();

      const collidingSlug = `f095-atomic-${Date.now()}`;

      // Seed a workspace that already owns this slug (via the admin client,
      // same as other fixtures in this suite), so the RPC's own workspace
      // INSERT is guaranteed to hit the unique constraint on `slug` and
      // raise inside the function body.
      const { data: seeded, error: seedError } = await adminClient
        .from("workspaces")
        .insert({ name: "F095 slug holder", slug: collidingSlug })
        .select("id")
        .single();
      if (seedError || !seeded) {
        throw new Error(`Failed to seed colliding workspace: ${seedError?.message}`);
      }
      createdWorkspaceIds.push(seeded.id);

      const countBefore = async () => {
        const { count } = await adminClient
          .from("workspace_members")
          .select("id", { count: "exact", head: true })
          .eq("user_id", firstUserId);
        return count ?? 0;
      };

      const membershipCountBefore = await countBefore();

      const { data: rpcData, error: rpcError } = await firstSignedInClient.rpc(
        "create_workspace_with_owner",
        { p_name: "F095 Atomic Test", p_slug: collidingSlug },
      );

      // The function must raise (slug unique violation) rather than
      // silently succeeding or partially applying.
      expect(rpcData).toBeFalsy();
      expect(rpcError).toBeTruthy();

      // Because the whole function body is one implicit transaction, the
      // failed second insert must have rolled back the first: no second
      // workspace row with this user attached, and no new membership row
      // for this user at all.
      const { data: workspacesWithSlug } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("slug", collidingSlug);
      expect(workspacesWithSlug).toHaveLength(1); // only the seeded one
      expect(workspacesWithSlug![0]!.id).toBe(seeded.id);

      const membershipCountAfter = await countBefore();
      expect(membershipCountAfter).toBe(membershipCountBefore);
    });
  },
);
