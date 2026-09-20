// Integration test for F025: proves RLS refuses a direct write from a
// workspace member to a calendar_blocks row owned by another member, at
// the integration (database) level -- not just the UI level. Mirrors the
// admin-client/session-client pattern established by
// tests/integration/planner-block-rls.test.ts (F011).
//
// AS-050: a direct write (UPDATE/DELETE) to another member's calendar
// block is refused server-side by RLS.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// F064 (AS-050): tests/setup/testing-library.ts (vitest's global
// `setupFiles`, always runs before this file's module body) backfills
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY /
// SUPABASE_SECRET_KEY with placeholder values (and sets
// TEST_SUPABASE_ENV_DUMMY="1") whenever nothing real is already exported.
// A plain `!(key in process.env)` guard here would therefore always see
// those three keys as "already set" and discard the real `.env` values --
// this file's own credential detection would then run against the
// placeholders, either false-negatively skipping forever or (worse)
// false-positively dialing "http://127.0.0.1:54321". These specific keys
// are this file's own live-DB credentials, so it is safe -- and necessary
// -- for its OWN loadDotEnv to override just them whenever the value
// currently in process.env is a known-dummy placeholder; every other key
// keeps the standard "don't clobber what's already set" guard.
const LIVE_DB_CREDENTIAL_KEYS = new Set([
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SECRET_KEY",
]);

function loadDotEnv() {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  const contents = readFileSync(path, "utf8");
  const isDummyEnv = process.env.TEST_SUPABASE_ENV_DUMMY === "1";
  let overrodeCredential = false;
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!key) continue;
    const isMissing = !(key in process.env);
    const isOverridableDummy = isDummyEnv && LIVE_DB_CREDENTIAL_KEYS.has(key);
    if (isMissing || isOverridableDummy) {
      process.env[key] = value;
      if (isOverridableDummy) overrodeCredential = true;
    }
  }
  // The placeholder values are gone from this file's view now that real
  // ones were loaded -- clear the flag so this file's own haveAdminCreds
  // check (below) doesn't keep treating them as dummy.
  if (overrodeCredential) delete process.env.TEST_SUPABASE_ENV_DUMMY;
}

loadDotEnv();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
// F064 (AS-050 follow-up): tests/setup/testing-library.ts (global
// `setupFiles`, always runs first) backfills these same keys with
// placeholder values and sets TEST_SUPABASE_ENV_DUMMY="1" whenever no real
// Supabase env is already present. Because that backfill runs before this
// file's own loadDotEnv() above, the `!(key in process.env)` guard there
// can never overwrite the placeholders with real .env values, so checking
// mere truthiness made haveAdminCreds always true (and the suite always
// attempted the placeholder URL "http://127.0.0.1:54321" -- a hard FAIL,
// not a clean SKIP -- whenever nothing was listening there). Gating on
// TEST_SUPABASE_ENV_DUMMY (the same flag tests/unit/fts-tasks.test.ts's
// hasSupabaseEnv and tests/integration/support/live-db.ts's haveAdminCreds
// already check) restores a clean skip when only placeholders exist, while
// still running for real when genuine .env credentials are present.
const haveAdminCreds =
  Boolean(SUPABASE_URL && SECRET_KEY && PUBLISHABLE_KEY) &&
  process.env.TEST_SUPABASE_ENV_DUMMY !== "1";
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "planner-block-write-rls: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) as GitHub Actions repository secrets.",
  );
}

async function createSessionClientForUser(email: string, password: string) {
  const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to sign in test user: ${error.message}`);
  return client;
}

describe.skipIf(!haveAdminCreds)("Planner calendar_blocks write RLS (F025)", () => {
  let adminClient: SupabaseClient;
  const createdWorkspaceIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdBlockIds: string[] = [];
  let skipDueToNetwork = false;

  let workspaceId: string;

  let memberAUserId: string;
  let memberAEmail: string;
  const password = "Test-password-1!";
  let memberAClient: SupabaseClient;

  let memberBUserId: string;
  let memberBEmail: string;
  let memberBClient: SupabaseClient;

  let memberABlockId: string;

  beforeAll(async () => {
    try {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "Block Write RLS Workspace", slug: `blockwriterls-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;
      createdWorkspaceIds.push(workspaceId);

      memberAEmail = `blockwriterls-a-${uniqueSuffix}@example.com`;
      const { data: aAuth, error: aErr } = await adminClient.auth.admin.createUser({
        email: memberAEmail,
        password,
        email_confirm: true,
      });
      if (aErr || !aAuth.user) throw new Error(`Failed to create memberA: ${aErr?.message}`);
      memberAUserId = aAuth.user.id;
      createdUserIds.push(memberAUserId);

      memberBEmail = `blockwriterls-b-${uniqueSuffix}@example.com`;
      const { data: bAuth, error: bErr } = await adminClient.auth.admin.createUser({
        email: memberBEmail,
        password,
        email_confirm: true,
      });
      if (bErr || !bAuth.user) throw new Error(`Failed to create memberB: ${bErr?.message}`);
      memberBUserId = bAuth.user.id;
      createdUserIds.push(memberBUserId);

      const { error: membersErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: memberAUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: memberBUserId, role: "member", status: "active" },
      ]);
      if (membersErr) throw new Error(`Failed to seed members: ${membersErr.message}`);

      memberAClient = await createSessionClientForUser(memberAEmail, password);
      memberBClient = await createSessionClientForUser(memberBEmail, password);

      // memberA creates a calendar block via their own authenticated
      // session (RLS-enforced insert, not an admin bypass).
      const { data: block, error: blockErr } = await memberAClient
        .from("calendar_blocks")
        .insert({
          workspace_id: workspaceId,
          user_id: memberAUserId,
          title: "Owned by memberA",
          starts_at: "2026-09-21T08:00:00.000Z",
          ends_at: "2026-09-21T09:00:00.000Z",
        })
        .select("id")
        .single();
      if (blockErr || !block) throw new Error(`Failed to seed block: ${blockErr?.message}`);
      memberABlockId = block.id;
      createdBlockIds.push(memberABlockId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.toLowerCase().includes("fetch failed") ||
        msg.includes("ECONNREFUSED") ||
        msg.toLowerCase().includes("network")
      ) {
        skipDueToNetwork = true;
        return;
      }
      throw e;
    }
  });

  beforeEach((ctx) => {
    if (skipDueToNetwork) ctx.skip();
  });

  afterAll(async () => {
    if (skipDueToNetwork) return;
    for (const id of createdBlockIds) {
      await adminClient.from("calendar_blocks").delete().eq("id", id);
    }
    await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
    for (const id of createdWorkspaceIds) {
      await adminClient.from("workspaces").delete().eq("id", id);
    }
    for (const id of createdUserIds) {
      await adminClient.auth.admin.deleteUser(id);
    }
  });

  it("test_AS_050_memberB_cannot_update_memberAs_block", async () => {
    const { data, error } = await memberBClient
      .from("calendar_blocks")
      .update({ title: "Hijacked by memberB" })
      .eq("id", memberABlockId)
      .select("id");

    // RLS's `using (user_id = auth.uid())` clause on the update policy
    // filters the target row before the write applies -- no error, but
    // zero rows are affected/returned, and the row is left unchanged.
    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("title")
      .eq("id", memberABlockId)
      .single();
    expect(row?.title).toBe("Owned by memberA");
  });

  it("test_AS_050_memberB_cannot_delete_memberAs_block", async () => {
    const { data, error } = await memberBClient
      .from("calendar_blocks")
      .delete()
      .eq("id", memberABlockId)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);

    const { data: row } = await adminClient
      .from("calendar_blocks")
      .select("id")
      .eq("id", memberABlockId)
      .maybeSingle();
    expect(row).not.toBeNull();
  });
});
