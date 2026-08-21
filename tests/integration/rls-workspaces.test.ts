// Integration test for F012 RLS (AS-010, AS-011, AS-137, AS-138, AS-139).
//
// Verifies against the real linked Supabase project that:
//  - RLS is enabled and enforced (not just "compiles without erroring")
//  - a request using only the publishable/anon-equivalent key (no session)
//    reading `workspaces` or `workspace_members` gets zero rows back, not an
//    error (AS-138)
//  - a signed-in but non-member authenticated user also gets zero rows,
//    including via a join-style query (AS-010, AS-011, AS-139)
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment, e.g. in CI contexts that don't have project secrets — but
// runs for real whenever `.env` is populated, which is the case in this repo.

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveCoreCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY);
if (process.env.CI && !haveCoreCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveCoreCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveCoreCreds)(
  "RLS on workspaces/workspace_members (F012)",
  () => {
    let anonClient: SupabaseClient;

    beforeAll(() => {
      anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    });

    it("AS-137: RLS is enabled on workspaces and workspace_members (anon SELECT is filtered, not a schema error)", async () => {
      const { error } = await anonClient.from("workspaces").select("id").limit(1);
      // A real RLS-filtering setup returns an empty/successful result, not a
      // permissions error — absence of an error here plus zero rows below is
      // the evidence RLS is active and behaving as "filter", not "throw".
      expect(error).toBeNull();
    });

    it("AS-138: anon/publishable key with no session reading workspaces returns zero rows, not an error", async () => {
      const { data, error } = await anonClient.from("workspaces").select("*");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-138: anon/publishable key with no session reading workspace_members returns zero rows, not an error", async () => {
      const { data, error } = await anonClient
        .from("workspace_members")
        .select("*");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-011: anon/publishable key direct client call for workspaces is rejected by RLS (empty), not merely hidden by UI", async () => {
      const { data, error } = await anonClient
        .from("workspaces")
        .select("id, name, slug");
      expect(error).toBeNull();
      expect(data).toHaveLength(0);
    });

    it("AS-139: anon key join-style query (workspace_members joined to workspaces) returns zero rows via any table", async () => {
      const { data, error } = await anonClient
        .from("workspace_members")
        .select("id, role, workspaces(id, name)");
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);

describe.skipIf(!haveAdminCreds)(
  "RLS on workspaces/workspace_members — non-member authenticated user (F012)",
  () => {
    let adminClient: SupabaseClient;
    let memberWorkspaceId: string;
    let ownerUserId: string;
    let nonMemberEmail: string;
    let nonMemberPassword: string;
    let nonMemberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      // Create a workspace + an 'active' owner membership for a throwaway
      // user, then a *second* throwaway user who is never added as a member.
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ownerAuth, error: ownerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f012-owner-${uniqueSuffix}@example.com`,
          password: "Test-password-1!",
          email_confirm: true,
        });
      if (ownerAuthErr || !ownerAuth.user) {
        throw new Error(`Failed to create owner test user: ${ownerAuthErr?.message}`);
      }
      ownerUserId = ownerAuth.user.id;

      const { data: workspace, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F012 RLS test workspace", slug: `f012-rls-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      memberWorkspaceId = workspace.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: memberWorkspaceId,
        user_id: ownerUserId,
        role: "owner",
        status: "active",
      });
      if (memberErr) {
        throw new Error(`Failed to seed owner membership: ${memberErr.message}`);
      }

      nonMemberEmail = `f012-nonmember-${uniqueSuffix}@example.com`;
      nonMemberPassword = "Test-password-1!";
      const { error: nonMemberAuthErr } = await adminClient.auth.admin.createUser({
        email: nonMemberEmail,
        password: nonMemberPassword,
        email_confirm: true,
      });
      if (nonMemberAuthErr) {
        throw new Error(`Failed to create non-member test user: ${nonMemberAuthErr.message}`);
      }

      nonMemberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await nonMemberClient.auth.signInWithPassword({
        email: nonMemberEmail,
        password: nonMemberPassword,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in non-member test user: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      // Best-effort cleanup: remove seeded rows/users so re-runs stay clean.
      if (memberWorkspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", memberWorkspaceId);
        await adminClient.from("workspaces").delete().eq("id", memberWorkspaceId);
      }
      if (ownerUserId) {
        await adminClient.auth.admin.deleteUser(ownerUserId);
      }
      if (nonMemberClient) {
        const { data } = await nonMemberClient.auth.getUser();
        if (data.user) {
          await adminClient.auth.admin.deleteUser(data.user.id);
        }
      }
    });

    it("AS-010: a signed-in non-member cannot view a workspace they don't belong to", async () => {
      const { data, error } = await nonMemberClient
        .from("workspaces")
        .select("*")
        .eq("id", memberWorkspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-011: a signed-in non-member's direct client call for that workspace's members is rejected by RLS (empty)", async () => {
      const { data, error } = await nonMemberClient
        .from("workspace_members")
        .select("*")
        .eq("workspace_id", memberWorkspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-139: a signed-in non-member gets zero rows via a join-style query on workspace_members -> workspaces", async () => {
      const { data, error } = await nonMemberClient
        .from("workspace_members")
        .select("id, role, workspaces(id, name)")
        .eq("workspace_id", memberWorkspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-139: a signed-in non-member cannot see the workspace row via a workspaces->workspace_members join either", async () => {
      const { data, error } = await nonMemberClient
        .from("workspaces")
        .select("id, name, workspace_members(id, role)")
        .eq("id", memberWorkspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
