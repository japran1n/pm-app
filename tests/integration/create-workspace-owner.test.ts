// Integration test for F013 (AS-005, AS-006), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/rls-workspaces.test.ts.
//
// `@/lib/supabase/server`'s `createClient()` is mocked so `auth.getUser()`
// resolves to a real throwaway Supabase Auth user without needing a live
// Next.js request/cookie context (createServerClient() requires
// `next/headers`'s `cookies()`, which only works inside an actual request).
// Everything downstream of that — the workspace insert, the membership
// insert, slug collision handling — runs against the real database via the
// same admin client `createWorkspace` itself uses, so this proves AS-006
// against real Postgres/RLS-table constraints, not a mock.

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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);

let currentTestUserId: string | null = null;

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
  }),
}));

describe.skipIf(!haveAdminCreds)(
  "createWorkspace (F013: AS-005, AS-006)",
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

    async function createThrowawayUser() {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data, error } = await adminClient.auth.admin.createUser({
        email: `f013-owner-${uniqueSuffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (error || !data.user) {
        throw new Error(`Failed to create test user: ${error?.message}`);
      }
      createdUserIds.push(data.user.id);
      return data.user.id;
    }

    it("AS-006: creating a workspace makes the creating user its owner (active)", async () => {
      const { createWorkspace } = await import("@/lib/actions/workspaces");

      const userId = await createThrowawayUser();
      currentTestUserId = userId;

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

      const userId = await createThrowawayUser();
      currentTestUserId = userId;

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

      const formData = new FormData();
      formData.set("name", `F013 No Auth ${Date.now()}`);

      const result = await createWorkspace(null, formData);

      expect(result).toEqual({
        ok: false,
        error: "You must be signed in to create a workspace.",
      });
    });
  },
);
