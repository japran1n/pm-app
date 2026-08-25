// Integration test for F263 (AS-510): project_favorites table + RLS, run
// against the real linked Supabase project. Mirrors the
// loadDotEnv/real-signed-in-client/beforeAll-seed/afterAll-teardown
// pattern established by tests/integration/rls-saved-views.test.ts.
//
// This proves the "own-row RLS, not project-scoped" own migration header
// comment via the DIRECT PostgREST path (each user's own real, signed-in
// session client) rather than only via the Server Action -- per this
// mission's NEXT-SESSION.md "hard-won lesson" that RLS must be exercised
// this way, not just through the application layer.

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
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F263: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "F263 project_favorites schema + RLS (AS-510)",
  () => {
    let adminClient: SupabaseClient;
    const createdWorkspaceIds: string[] = [];
    const createdUserIds: string[] = [];
    const createdProjectIds: string[] = [];

    let workspaceId: string;
    let projectAId: string;
    let projectBId: string;

    let userAEmail: string;
    let userBEmail: string;
    const password = "Test-password-1!";
    let userAId: string;
    let userBId: string;

    async function signInAs(email: string, pwd: string) {
      const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error } = await client.auth.signInWithPassword({
        email,
        password: pwd,
      });
      if (error) {
        throw new Error(`Failed to sign in ${email}: ${error.message}`);
      }
      return client;
    }

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F263 Workspace", slug: `f263-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws)
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      userAEmail = `f263-a-${uniqueSuffix}@example.com`;
      userBEmail = `f263-b-${uniqueSuffix}@example.com`;

      const { data: userAData, error: userAErr } =
        await adminClient.auth.admin.createUser({
          email: userAEmail,
          password,
          email_confirm: true,
        });
      if (userAErr || !userAData.user)
        throw new Error(`Failed to create user A: ${userAErr?.message}`);
      userAId = userAData.user.id;
      createdUserIds.push(userAId);

      const { data: userBData, error: userBErr } =
        await adminClient.auth.admin.createUser({
          email: userBEmail,
          password,
          email_confirm: true,
        });
      if (userBErr || !userBData.user)
        throw new Error(`Failed to create user B: ${userBErr?.message}`);
      userBId = userBData.user.id;
      createdUserIds.push(userBId);

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert([
          {
            workspace_id: workspaceId,
            user_id: userAId,
            role: "member",
            status: "active",
          },
          {
            workspace_id: workspaceId,
            user_id: userBId,
            role: "member",
            status: "active",
          },
        ]);
      if (memberErr) throw new Error(`Failed to seed members: ${memberErr.message}`);

      const { data: projA, error: projAErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F263 Project A ${uniqueSuffix}`,
          created_by: userAId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projAErr || !projA)
        throw new Error(`Failed to create project A: ${projAErr?.message}`);
      projectAId = projA.id;
      createdProjectIds.push(projectAId);

      const { data: projB, error: projBErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F263 Project B ${uniqueSuffix}`,
          created_by: userBId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projBErr || !projB)
        throw new Error(`Failed to create project B: ${projBErr?.message}`);
      projectBId = projB.id;
      createdProjectIds.push(projectBId);
    });

    afterAll(async () => {
      for (const pId of createdProjectIds) {
        await adminClient.from("project_favorites").delete().eq("project_id", pId);
        await adminClient.from("projects").delete().eq("id", pId);
      }
      for (const wsId of createdWorkspaceIds) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", wsId);
        await adminClient.from("workspaces").delete().eq("id", wsId);
      }
      for (const userId of createdUserIds) {
        await adminClient.auth.admin.deleteUser(userId);
      }
    });

    it("test_AS_510_a_user_can_favourite_a_project_they_can_see_via_their_own_session", async () => {
      const clientA = await signInAs(userAEmail, password);
      const { data, error } = await clientA
        .from("project_favorites")
        .insert({ user_id: userAId, project_id: projectAId })
        .select("user_id, project_id")
        .single();

      expect(error).toBeNull();
      expect(data?.user_id).toBe(userAId);
      expect(data?.project_id).toBe(projectAId);
    });

    it("test_AS_510_the_same_pair_cannot_be_favourited_twice_composite_pk", async () => {
      const clientA = await signInAs(userAEmail, password);
      // Idempotent app-level toggle uses upsert; a bare duplicate insert
      // must be rejected by the composite primary key.
      const { error } = await clientA
        .from("project_favorites")
        .insert({ user_id: userAId, project_id: projectAId });

      expect(error).not.toBeNull();
      expect(error?.code).toBe("23505");
    });

    it("test_AS_510_a_user_can_unfavourite_remove_their_own_favourite", async () => {
      const clientA = await signInAs(userAEmail, password);
      const { error: deleteErr } = await clientA
        .from("project_favorites")
        .delete()
        .eq("user_id", userAId)
        .eq("project_id", projectAId);
      expect(deleteErr).toBeNull();

      const { data: remaining } = await clientA
        .from("project_favorites")
        .select("project_id")
        .eq("user_id", userAId)
        .eq("project_id", projectAId);
      expect(remaining ?? []).toHaveLength(0);

      // Re-seed for the following tests.
      const { error: reinsertErr } = await adminClient
        .from("project_favorites")
        .insert({ user_id: userAId, project_id: projectAId });
      expect(reinsertErr).toBeNull();
    });

    it("test_AS_510_a_user_cannot_see_another_users_favourites_via_a_direct_select", async () => {
      // Seed B's own favourite directly via the admin client.
      await adminClient
        .from("project_favorites")
        .upsert(
          { user_id: userBId, project_id: projectBId },
          { onConflict: "user_id,project_id" },
        );

      const clientA = await signInAs(userAEmail, password);

      // A direct select scoped to B's user_id returns nothing for A's
      // session -- own-row RLS, not visible cross-user regardless of how
      // the query is filtered.
      const { data: viaUserIdFilter } = await clientA
        .from("project_favorites")
        .select("user_id, project_id")
        .eq("user_id", userBId);
      expect(viaUserIdFilter ?? []).toHaveLength(0);

      // An unfiltered select of "all rows I can see" must also never
      // include B's row, proving RLS -- not just app-level filtering --
      // is what keeps A's session scoped to A's own rows.
      const { data: viaUnfiltered } = await clientA
        .from("project_favorites")
        .select("user_id, project_id");
      expect(
        (viaUnfiltered ?? []).some((row) => row.user_id === userBId),
      ).toBe(false);
    });

    it("test_AS_510_a_user_cannot_toggle_delete_another_users_favourite_via_a_direct_mutation", async () => {
      const clientA = await signInAs(userAEmail, password);

      const { data: deleteResult, error: deleteErr } = await clientA
        .from("project_favorites")
        .delete()
        .eq("user_id", userBId)
        .eq("project_id", projectBId)
        .select("user_id");
      // RLS's USING clause silently excludes rows not owned by the caller
      // -- zero rows affected, not an error, matching this repo's
      // established RLS-delete convention (e.g. rls-saved-views.test.ts's
      // own "update/delete affects zero rows" assertions).
      expect(deleteErr).toBeNull();
      expect(deleteResult ?? []).toHaveLength(0);

      // B's row is untouched.
      const { data: stillThere } = await adminClient
        .from("project_favorites")
        .select("user_id")
        .eq("user_id", userBId)
        .eq("project_id", projectBId);
      expect(stillThere ?? []).toHaveLength(1);
    });

    it("test_AS_510_a_user_cannot_insert_a_favourite_attributed_to_someone_elses_user_id", async () => {
      const clientA = await signInAs(userAEmail, password);
      const { data, error } = await clientA
        .from("project_favorites")
        .insert({ user_id: userBId, project_id: projectAId })
        .select("user_id");

      // RLS with_check rejects this: either a returned error or zero rows.
      expect(error !== null || (data ?? []).length === 0).toBe(true);
    });

    it("test_project_hard_delete_still_succeeds_with_a_favourite_present_ON_DELETE_CASCADE", async () => {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: proj, error: projErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F263 Cascade Project ${uniqueSuffix}`,
          created_by: userAId,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (projErr || !proj)
        throw new Error(`Failed to create project: ${projErr?.message}`);
      const cascadeProjectId = proj.id as string;

      const { error: insertErr } = await adminClient
        .from("project_favorites")
        .insert({ user_id: userAId, project_id: cascadeProjectId });
      expect(insertErr).toBeNull();

      const { error: deleteErr } = await adminClient
        .from("projects")
        .delete()
        .eq("id", cascadeProjectId);
      expect(deleteErr).toBeNull();

      const { data: remaining } = await adminClient
        .from("project_favorites")
        .select("project_id")
        .eq("project_id", cascadeProjectId);
      expect(remaining ?? []).toHaveLength(0);
    });
  },
);
