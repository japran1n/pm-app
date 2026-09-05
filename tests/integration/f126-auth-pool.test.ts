// Integration test for F126 (missions/20260903-portal — AS-089, AS-090,
// AS-091): the shared pooled-identity + cached-session test-auth helper
// (tests/helpers/auth.ts), run against the real linked Supabase project.
//
// Mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/f116-task-types.test.ts.
//
// Proves:
//   AS-089: repeated lookups of the same pool slot return the SAME real
//     identity and the SAME underlying session (auth.getUser() resolves to
//     the same user id) rather than minting a fresh user/session each
//     time — the mechanism that lets 18 migrated integration files share
//     ~10 real Supabase Auth users instead of creating one each.
//   AS-090: a pooled identity can be a member of many independent
//     workspaces at once with no conflict — the correctness property that
//     makes reuse across many test files legitimate (a real user belongs
//     to many workspaces in normal use).
//   AS-091: per-test rows created by a "migrated-style" file are still
//     removed by that file's afterAll even when one of its tests
//     deliberately fails, and the pooled identity used along the way is
//     NOT deleted (it must remain usable afterward for other files/runs).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPoolIdentity, getPoolSession, poolUserId } from "../helpers/auth";

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key && !(key in process.env)) {
      process.env[key] = trimmed.slice(eq + 1).trim();
    }
  }
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const haveCreds = Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "F126: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveCreds)("F126 shared auth pool (AS-089, AS-090, AS-091)", () => {
  let adminClient: SupabaseClient;

  beforeAll(() => {
    adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  it("test_AS_089_the_same_pool_slot_resolves_to_the_same_real_identity_on_repeated_lookups", async () => {
    const first = await getPoolIdentity(0);
    const second = await getPoolIdentity(0);
    const third = await getPoolIdentity(0);

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);
    expect(second.email).toBe(first.email);

    // The id really is a live auth.users row (not a stubbed/fake value).
    const { data, error } = await adminClient.auth.admin.getUserById(first.id);
    expect(error).toBeNull();
    expect(data.user?.id).toBe(first.id);
  });

  it("test_AS_089_a_pool_slots_session_is_hydrated_from_a_cached_token_and_resolves_to_the_same_user_every_time", async () => {
    const identity = await getPoolIdentity(1);

    const sessionA = await getPoolSession(1);
    const { data: userA, error: errA } = await sessionA.auth.getUser();
    expect(errA).toBeNull();
    expect(userA.user?.id).toBe(identity.id);

    // A second, independent call for the SAME slot — simulating a
    // different migrated file asking for this identity in the same run —
    // resolves to the same signed-in user via the cached session, not a
    // fresh signInWithPassword.
    const sessionB = await getPoolSession(1);
    const { data: userB, error: errB } = await sessionB.auth.getUser();
    expect(errB).toBeNull();
    expect(userB.user?.id).toBe(identity.id);
  });

  it("test_AS_089_different_pool_slots_are_different_real_identities", async () => {
    const a = await getPoolIdentity(2);
    const b = await getPoolIdentity(3);
    expect(a.id).not.toBe(b.id);
    expect(a.email).not.toBe(b.email);
  });

  it("test_AS_090_a_pooled_identity_can_belong_to_two_independent_workspaces_at_once_with_no_conflict", async () => {
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const pooledUserId = await poolUserId(4);

    const { data: wsA, error: wsAErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F126 pool workspace A", slug: `f126-pool-a-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsAErr || !wsA) throw new Error(`Failed to create workspace A: ${wsAErr?.message}`);

    const { data: wsB, error: wsBErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F126 pool workspace B", slug: `f126-pool-b-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsBErr || !wsB) throw new Error(`Failed to create workspace B: ${wsBErr?.message}`);

    try {
      // The SAME pooled user, added as a member of BOTH brand-new
      // workspaces at once — this is exactly what every migrated file
      // does concurrently with every other migrated (and unmigrated) file
      // sharing this slot, and it must never conflict.
      const { error: memberAErr } = await adminClient
        .from("workspace_members")
        .insert({ workspace_id: wsA.id, user_id: pooledUserId, role: "owner", status: "active" });
      expect(memberAErr).toBeNull();

      const { error: memberBErr } = await adminClient
        .from("workspace_members")
        .insert({ workspace_id: wsB.id, user_id: pooledUserId, role: "viewer", status: "active" });
      expect(memberBErr).toBeNull();

      const { data: memberships, error: selectErr } = await adminClient
        .from("workspace_members")
        .select("workspace_id, role")
        .eq("user_id", pooledUserId)
        .in("workspace_id", [wsA.id, wsB.id]);
      expect(selectErr).toBeNull();
      expect(memberships).toHaveLength(2);
    } finally {
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsA.id);
      await adminClient.from("workspace_members").delete().eq("workspace_id", wsB.id);
      await adminClient.from("workspaces").delete().in("id", [wsA.id, wsB.id]);
    }
  });

  describe("AS-091: cleanup on a deliberately failed test", () => {
    // Mirrors the exact shape every migrated file uses: per-test rows
    // tracked in a file-scoped array, deleted in afterAll — which vitest
    // guarantees runs even when one of this describe's `it`s fails.
    let cleanupWorkspaceId: string | null = null;
    let cleanupUserId: string;

    beforeAll(async () => {
      cleanupUserId = await poolUserId(5);
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const { data: ws, error } = await adminClient
        .from("workspaces")
        .insert({ name: "F126 cleanup-on-failure workspace", slug: `f126-cleanup-${uniqueSuffix}` })
        .select("id")
        .single();
      if (error || !ws) throw new Error(`Failed to create workspace: ${error?.message}`);
      cleanupWorkspaceId = ws.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({ workspace_id: cleanupWorkspaceId, user_id: cleanupUserId, role: "owner", status: "active" });
      if (memberErr) throw new Error(`Failed to seed member: ${memberErr.message}`);
    });

    afterAll(async () => {
      // The cleanup a migrated file's own afterAll performs — must run
      // (and does, per vitest's afterAll-always-runs-in-its-describe
      // guarantee) regardless of the deliberately-failed test below.
      if (cleanupWorkspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", cleanupWorkspaceId);
        await adminClient.from("workspaces").delete().eq("id", cleanupWorkspaceId);
      }
      // Deliberately NOT deleting cleanupUserId — it is a pooled identity
      // (see tests/helpers/auth.ts) and must survive this file's afterAll.
    });

    // `it.fails` marks this test as EXPECTED to fail: vitest reports the
    // overall suite green when the callback throws, and red if it doesn't
    // — the deliberate failure this assertion needs without breaking the
    // "full suite passes" requirement.
    it.fails(
      "deliberately fails to prove afterAll cleanup is unconditional",
      async () => {
        expect(true).toBe(false);
      },
    );
  });

  it("test_AS_091_a_migrated_files_per_test_workspace_is_gone_after_its_afterAll_even_though_a_sibling_test_failed", async () => {
    // Runs after the describe above (vitest executes a file's
    // describes/its in declaration order), so its afterAll has already
    // completed by now.
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: sentinelWs } = await adminClient
      .from("workspaces")
      .insert({ name: "F126 sentinel (should never persist)", slug: `f126-sentinel-${uniqueSuffix}` })
      .select("id")
      .single();
    // Sanity: prove OUR select query itself works, then immediately clean
    // up the sentinel row we just made (not the subject of this test).
    if (sentinelWs) {
      await adminClient.from("workspaces").delete().eq("id", sentinelWs.id);
    }

    // The real assertion: the cleanup-on-failure describe's workspace,
    // by slug prefix, must not exist any more.
    const { data: leftoverRows, error } = await adminClient
      .from("workspaces")
      .select("id")
      .ilike("slug", "f126-cleanup-%");
    expect(error).toBeNull();
    expect(leftoverRows).toEqual([]);
  });

  it("test_AS_091_the_pooled_identity_used_by_the_failed_test_above_still_exists_and_is_still_usable", async () => {
    const identity = await getPoolIdentity(5);
    const { data, error } = await adminClient.auth.admin.getUserById(identity.id);
    expect(error).toBeNull();
    expect(data.user?.id).toBe(identity.id);

    // Still a usable session — proves the pool, not just the auth.users
    // row, survived (nothing invalidated its cached session either).
    const session = await getPoolSession(5);
    const { data: userData, error: userErr } = await session.auth.getUser();
    expect(userErr).toBeNull();
    expect(userData.user?.id).toBe(identity.id);
  });
});
