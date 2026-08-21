// Integration test for F014 (AS-012, AS-013, AS-042), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/rls-workspaces.test.ts.
//
// The workspace-switcher layout (app/(workspace)/w/[workspaceSlug]/layout.tsx)
// is a Server Component that needs a live Next.js request/cookie context to
// render, so it isn't unit-rendered here. Instead this test exercises the
// exact same two queries the layout runs, against a real signed-in user with
// two workspace memberships:
//   1. resolve a workspace by slug, scoped to active membership (RLS)
//   2. list every active-membership workspace for that user (switcher data)
// and proves both are correctly scoped per-user (AS-012, AS-013, AS-042).

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
  "workspace switcher data scope (F014: AS-012, AS-013, AS-042)",
  () => {
    let adminClient: SupabaseClient;
    let userClient: SupabaseClient;
    let userId: string;
    let workspaceAId: string;
    let workspaceBId: string;
    let workspaceASlug: string;
    let workspaceBSlug: string;
    let otherUserId: string;
    let otherWorkspaceId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `f014-switcher-${uniqueSuffix}@example.com`;
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

      workspaceASlug = `f014-ws-a-${uniqueSuffix}`;
      workspaceBSlug = `f014-ws-b-${uniqueSuffix}`;

      const { data: wsA, error: wsAErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F014 Workspace A", slug: workspaceASlug })
        .select("id")
        .single();
      if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);
      workspaceAId = wsA.id;

      const { data: wsB, error: wsBErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F014 Workspace B", slug: workspaceBSlug })
        .select("id")
        .single();
      if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);
      workspaceBId = wsB.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceAId, user_id: userId, role: "owner", status: "active" },
        { workspace_id: workspaceBId, user_id: userId, role: "member", status: "active" },
      ]);
      if (memberErr) throw new Error(`Failed to seed memberships: ${memberErr.message}`);

      // A third workspace belonging to a *different* user — proves the
      // switcher query never leaks another user's workspaces (AS-012/AS-042
      // scoping, not just presence).
      const { data: otherAuth, error: otherAuthErr } =
        await adminClient.auth.admin.createUser({
          email: `f014-other-${uniqueSuffix}@example.com`,
          password,
          email_confirm: true,
        });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other test user: ${otherAuthErr?.message}`);
      }
      otherUserId = otherAuth.user.id;

      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F014 Other User Workspace", slug: `f014-ws-other-${uniqueSuffix}` })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) throw new Error(`Failed to create other workspace: ${otherWsErr?.message}`);
      otherWorkspaceId = otherWs.id;

      const { error: otherMemberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: otherWorkspaceId,
        user_id: otherUserId,
        role: "owner",
        status: "active",
      });
      if (otherMemberErr) throw new Error(`Failed to seed other membership: ${otherMemberErr.message}`);

      userClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(`Failed to sign in test user: ${signInErr.message}`);
    });

    afterAll(async () => {
      for (const id of [workspaceAId, workspaceBId, otherWorkspaceId]) {
        if (!id) continue;
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      for (const id of [userId, otherUserId]) {
        if (id) await adminClient.auth.admin.deleteUser(id);
      }
    });

    it("AS-012: a user with multiple active memberships sees all of them in the switcher query", async () => {
      const { data: memberships, error: membershipsError } = await userClient
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .eq("status", "active");

      expect(membershipsError).toBeNull();
      const ids = (memberships ?? []).map((m) => m.workspace_id).sort();
      expect(ids).toEqual([workspaceAId, workspaceBId].sort());

      const { data: workspaces, error: workspacesError } = await userClient
        .from("workspaces")
        .select("id, name, slug")
        .in("id", ids);

      expect(workspacesError).toBeNull();
      expect(workspaces).toHaveLength(2);
      expect(workspaces?.map((w) => w.name).sort()).toEqual([
        "F014 Workspace A",
        "F014 Workspace B",
      ]);
    });

    it("AS-012/AS-042 (isolation): the switcher query never returns another user's workspace", async () => {
      const { data: workspaces, error } = await userClient
        .from("workspaces")
        .select("id, name")
        .in("id", [workspaceAId, workspaceBId, otherWorkspaceId]);

      expect(error).toBeNull();
      expect(workspaces?.map((w) => w.id).sort()).toEqual(
        [workspaceAId, workspaceBId].sort(),
      );
      expect(workspaces?.some((w) => w.id === otherWorkspaceId)).toBe(false);
    });

    it("AS-013: resolving the active workspace by slug (the layout's guard query) works per-slug and stays scoped to the caller's memberships", async () => {
      const { data: activeA, error: errA } = await userClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", workspaceASlug)
        .maybeSingle();
      expect(errA).toBeNull();
      expect(activeA?.id).toBe(workspaceAId);

      const { data: activeB, error: errB } = await userClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", workspaceBSlug)
        .maybeSingle();
      expect(errB).toBeNull();
      expect(activeB?.id).toBe(workspaceBId);
    });

    it("AS-013 (failure case): resolving a workspace the caller isn't a member of returns no row, not an error", async () => {
      const { data: otherWs, error } = await adminClient
        .from("workspaces")
        .select("slug")
        .eq("id", otherWorkspaceId)
        .single();
      expect(error).toBeNull();

      const { data: active, error: activeErr } = await userClient
        .from("workspaces")
        .select("id, name, slug")
        .eq("slug", otherWs!.slug)
        .maybeSingle();

      expect(activeErr).toBeNull();
      expect(active).toBeNull();
    });
  },
);
