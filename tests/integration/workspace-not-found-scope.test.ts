// Integration test for F023 (AS-144), run against the real linked Supabase
// project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/rls-workspaces.test.ts and
// tests/integration/workspace-switcher-scope.test.ts.
//
// The workspace layout (app/(workspace)/w/[workspaceSlug]/layout.tsx) is a
// Server Component that needs a live Next.js request/cookie context to
// render, so it isn't unit-rendered here. Instead this test exercises the
// exact query the layout runs to resolve the active workspace by slug
// (`workspaces` select scoped by `workspaces_select_active_members` RLS,
// `.maybeSingle()`), which is the only signal the layout branches on before
// calling `notFound()`.
//
// AS-144's actual guarantee isn't "returns 404" — it's that a non-member
// gets the SAME result (and therefore the same rendered outcome) whether
// the workspace slug doesn't exist at all, or exists but they aren't an
// active member of it. This test asserts that identity directly: both
// queries resolve to `null` with no error, so the layout's
// `if (!activeWorkspace) notFound()` branch is taken identically in both
// cases and a non-member cannot distinguish "doesn't exist" from "exists,
// not a member" from the response shape.

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "workspace not-found scoping (F023: AS-144)",
  () => {
    let adminClient: SupabaseClient;
    let userClient: SupabaseClient;
    let userId: string;
    let existingWorkspaceId: string;
    let existingWorkspaceSlug: string;
    const nonexistentSlug = `f023-nonexistent-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `f023-notfound-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";

      const { data: auth, error: authErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authErr || !auth.user) {
        throw new Error(`Failed to create test user: ${authErr?.message}`);
      }
      userId = auth.user.id;

      existingWorkspaceSlug = `f023-ws-existing-${uniqueSuffix}`;

      // A real, existing workspace that `userId` is deliberately NOT a
      // member of — owned by a different user.
      const { data: ownerAuth, error: ownerAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f023-owner-${uniqueSuffix}@example.com`,
          password,
          email_confirm: true,
        });
      if (ownerAuthErr || !ownerAuth.user) {
        throw new Error(`Failed to create owner test user: ${ownerAuthErr?.message}`);
      }

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F023 Existing Workspace", slug: existingWorkspaceSlug })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      existingWorkspaceId = ws.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: existingWorkspaceId,
        user_id: ownerAuth.user.id,
        role: "owner",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed owner membership: ${memberErr.message}`);

      userClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(`Failed to sign in test user: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (existingWorkspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", existingWorkspaceId);
        await adminClient.from("workspaces").delete().eq("id", existingWorkspaceId);
      }
      if (userId) await adminClient.auth.admin.deleteUser(userId);
    });

    it("AS-144: a nonexistent slug and an existing-but-not-a-member slug resolve identically for a non-member", async () => {
      // Sanity: the "existing" workspace really does exist (admin can see
      // it) — otherwise this test wouldn't be distinguishing the two cases
      // at all.
      const { data: adminView, error: adminErr } = await adminClient
        .from("workspaces")
        .select("id")
        .eq("slug", existingWorkspaceSlug)
        .maybeSingle();
      expect(adminErr).toBeNull();
      expect(adminView?.id).toBe(existingWorkspaceId);

      // The exact query app/(workspace)/w/[workspaceSlug]/layout.tsx runs,
      // scoped by RLS to the signed-in non-member user, against a slug that
      // doesn't exist at all.
      const nonexistentResult = await userClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", nonexistentSlug)
        .maybeSingle();

      // Same query, same non-member user, against a slug that DOES exist
      // but the user has no active membership row for.
      const notAMemberResult = await userClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", existingWorkspaceSlug)
        .maybeSingle();

      // Both must produce no row and no error — the layout's `if
      // (!activeWorkspace) notFound()` branch fires identically in both
      // cases, so the two are indistinguishable from the outside.
      expect(nonexistentResult.error).toBeNull();
      expect(notAMemberResult.error).toBeNull();
      expect(nonexistentResult.data).toBeNull();
      expect(notAMemberResult.data).toBeNull();

      // Assert the full result shape is identical, not just "both falsy" —
      // this is what actually guarantees AS-144's non-leakage property.
      expect(notAMemberResult.data).toEqual(nonexistentResult.data);
      expect(notAMemberResult.status).toEqual(nonexistentResult.status);
      expect(notAMemberResult.error).toEqual(nonexistentResult.error);
    });
  },
);
