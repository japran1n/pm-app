// Integration test for F025 RLS on `projects` (AS-028).
//
// Verifies against the real linked Supabase project that:
//  - a member of workspace A can SELECT/INSERT/UPDATE projects in
//    workspace A
//  - a signed-in user who is NOT a member of workspace A cannot view a
//    project belonging to workspace A, including via a join-style query
//    (AS-028)
//  - the anon/publishable key with no session reading `projects` returns
//    zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in the
// environment — but runs for real whenever `.env` is populated, which is the
// case in this repo. Mirrors tests/integration/rls-workspaces.test.ts (F012).

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

describe.skipIf(!haveCoreCreds)("RLS on projects (F025) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("AS-028: anon/publishable key with no session reading projects returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("projects").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS on projects — member vs non-member of the owning workspace (F025)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceAId: string;
    let workspaceBId: string;
    let projectAId: string;
    let memberAUserId: string;
    let nonMemberEmail: string;
    let nonMemberPassword: string;
    let memberAEmail: string;
    let memberAPassword: string;
    let memberAClient: SupabaseClient;
    let nonMemberClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      // Workspace A + an active member of it.
      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F025 RLS workspace A", slug: `f025-rls-a-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsAErr || !wsA) {
        throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      }
      workspaceAId = wsA.id;

      memberAEmail = `f025-member-a-${uniqueSuffix}@example.com`;
      memberAPassword = "Test-password-1!";
      const { data: memberAAuth, error: memberAAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberAEmail,
          password: memberAPassword,
          email_confirm: true,
        });
      if (memberAAuthErr || !memberAAuth.user) {
        throw new Error(`Failed to create member-A test user: ${memberAAuthErr?.message}`);
      }
      memberAUserId = memberAAuth.user.id;

      const { error: memberAInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceAId,
        user_id: memberAUserId,
        role: "owner",
        status: "active",
      });
      if (memberAInsertErr) {
        throw new Error(`Failed to seed member-A membership: ${memberAInsertErr.message}`);
      }

      // A project belonging to workspace A, seeded via the secret-key client
      // (bypasses RLS by design, standing in for "already exists").
      const { data: projectA, error: projectAErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F025 RLS test project" })
        .select("id")
        .single();
      if (projectAErr || !projectA) {
        throw new Error(`Failed to seed project A: ${projectAErr?.message}`);
      }
      projectAId = projectA.id;

      // Workspace B, used only so the non-member has *some* workspace context
      // and to prove cross-workspace isolation, not just "no workspace at all".
      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F025 RLS workspace B", slug: `f025-rls-b-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsBErr || !wsB) {
        throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      }
      workspaceBId = wsB.id;

      nonMemberEmail = `f025-nonmember-${uniqueSuffix}@example.com`;
      nonMemberPassword = "Test-password-1!";
      const { data: nonMemberAuth, error: nonMemberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: nonMemberEmail,
          password: nonMemberPassword,
          email_confirm: true,
        });
      if (nonMemberAuthErr || !nonMemberAuth.user) {
        throw new Error(`Failed to create non-member test user: ${nonMemberAuthErr?.message}`);
      }
      // Non-member is an active member of workspace B only — never workspace A.
      const { error: nonMemberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceBId,
        user_id: nonMemberAuth.user.id,
        role: "owner",
        status: "active",
      });
      if (nonMemberInsertErr) {
        throw new Error(`Failed to seed non-member's workspace-B membership: ${nonMemberInsertErr.message}`);
      }

      memberAClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberASignInErr } = await memberAClient.auth.signInWithPassword({
        email: memberAEmail,
        password: memberAPassword,
      });
      if (memberASignInErr) {
        throw new Error(`Failed to sign in member-A test user: ${memberASignInErr.message}`);
      }

      nonMemberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: nonMemberSignInErr } = await nonMemberClient.auth.signInWithPassword({
        email: nonMemberEmail,
        password: nonMemberPassword,
      });
      if (nonMemberSignInErr) {
        throw new Error(`Failed to sign in non-member test user: ${nonMemberSignInErr.message}`);
      }
    });

    afterAll(async () => {
      // Best-effort cleanup so re-runs stay clean.
      if (projectAId) {
        await adminClient.from("projects").delete().eq("id", projectAId);
      }
      if (workspaceAId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceAId);
        await adminClient.from("workspaces").delete().eq("id", workspaceAId);
      }
      if (workspaceBId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceBId);
        await adminClient.from("workspaces").delete().eq("id", workspaceBId);
      }
      if (memberAUserId) {
        await adminClient.auth.admin.deleteUser(memberAUserId);
      }
      if (nonMemberClient) {
        const { data } = await nonMemberClient.auth.getUser();
        if (data.user) {
          await adminClient.auth.admin.deleteUser(data.user.id);
        }
      }
    });

    it("a member of workspace A can SELECT workspace A's project", async () => {
      const { data, error } = await memberAClient
        .from("projects")
        .select("id, name, workspace_id")
        .eq("id", projectAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
      expect(data?.[0]?.id).toBe(projectAId);
    });

    it("a member of workspace A can INSERT a new project into workspace A", async () => {
      const { data, error } = await memberAClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "F025 member-created project" })
        .select("id, workspace_id")
        .single();
      expect(error).toBeNull();
      expect(data?.workspace_id).toBe(workspaceAId);
      if (data?.id) {
        await adminClient.from("projects").delete().eq("id", data.id);
      }
    });

    it("a member of workspace A can UPDATE workspace A's project", async () => {
      const { data, error } = await memberAClient
        .from("projects")
        .update({ description: "updated by member A" })
        .eq("id", projectAId)
        .select("id, description")
        .single();
      expect(error).toBeNull();
      expect(data?.description).toBe("updated by member A");
    });

    it("AS-028: a member of workspace A cannot INSERT a project claiming a workspace_id they don't belong to", async () => {
      const { error } = await nonMemberClient
        .from("projects")
        .insert({ workspace_id: workspaceAId, name: "should be rejected" });
      expect(error).not.toBeNull();
    });

    it("AS-028: a user with no membership in workspace A gets zero rows querying workspace A's project directly", async () => {
      const { data, error } = await nonMemberClient
        .from("projects")
        .select("*")
        .eq("id", projectAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-028: a user with no membership in workspace A gets zero rows via a join-style query (projects -> workspaces)", async () => {
      const { data, error } = await nonMemberClient
        .from("projects")
        .select("id, name, workspaces(id, name)")
        .eq("id", projectAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-028: a user with no membership in workspace A cannot UPDATE workspace A's project", async () => {
      const { data, error } = await nonMemberClient
        .from("projects")
        .update({ description: "should not be applied" })
        .eq("id", projectAId)
        .select("id");
      expect(error).toBeNull();
      expect(data).toEqual([]);

      // Confirm via the admin client that the row was left untouched.
      const { data: unchanged } = await adminClient
        .from("projects")
        .select("description")
        .eq("id", projectAId)
        .single();
      expect(unchanged?.description).not.toBe("should not be applied");
    });

    it("AS-028: full list query scoped to workspace A returns zero rows for a non-member", async () => {
      const { data, error } = await nonMemberClient
        .from("projects")
        .select("*")
        .eq("workspace_id", workspaceAId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  },
);
