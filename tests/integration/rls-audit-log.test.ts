// Integration test for F139 schema + RLS on `audit_log` (AS-247, AS-249).
//
// Verifies against the real linked Supabase project that:
//  - a regular ("member") workspace member's direct SELECT against
//    `audit_log` for their own workspace returns zero rows, not an error
//    (AS-247) — while an owner's direct SELECT for the same workspace
//    does see the row, proving the policy is role-gated, not just
//    workspace-gated
//  - an owner's/admin's direct UPDATE and DELETE attempts against an
//    existing audit_log row, from their own real (publishable-key)
//    session — not the service-role admin client — are rejected, because
//    no UPDATE/DELETE RLS policy exists for any role (AS-249)
//  - the SECURITY DEFINER `write_audit_log_entry` RPC, called from an
//    active member's own session, successfully inserts a row and pins
//    `actor_id` to the caller's own auth.uid(), not a client-supplied
//    value
//  - the anon/publishable key with no session reading `audit_log` returns
//    zero rows, not an error
//
// Skips (rather than fails) when Supabase credentials aren't present in
// the environment. Mirrors tests/integration/rls-active-timers.test.ts
// (F109).

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
    "F139: missing Supabase credentials required to run this suite in CI (haveCoreCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}
const haveAdminCreds = Boolean(SUPABASE_URL && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F139: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveCoreCreds)("RLS on audit_log (F139) — no session", () => {
  let anonClient: SupabaseClient;

  beforeAll(() => {
    anonClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  it("anon/publishable key with no session reading audit_log returns zero rows, not an error", async () => {
    const { data, error } = await anonClient.from("audit_log").select("*");
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });
});

describe.skipIf(!haveAdminCreds)(
  "RLS + append-only guarantees on audit_log — owner vs member (F139)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let ownerUserId: string;
    let ownerEmail: string;
    let ownerPassword: string;
    let memberEmail: string;
    let memberPassword: string;
    let ownerClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let seededRowId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F139 RLS workspace", slug: `f139-rls-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      ownerEmail = `f139-owner-${uniqueSuffix}@example.com`;
      ownerPassword = "Test-password-1!";
      const { data: ownerAuth, error: ownerAuthErr } = await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
      });
      if (ownerAuthErr || !ownerAuth.user) {
        throw new Error(`Failed to create owner test user: ${ownerAuthErr?.message}`);
      }
      ownerUserId = ownerAuth.user.id;

      const { error: ownerInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: ownerUserId,
        role: "owner",
        status: "active",
      });
      if (ownerInsertErr) {
        throw new Error(`Failed to seed owner membership: ${ownerInsertErr.message}`);
      }

      memberEmail = `f139-member-${uniqueSuffix}@example.com`;
      memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } = await adminClient.auth.admin.createUser({
        email: memberEmail,
        password: memberPassword,
        email_confirm: true,
      });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create member test user: ${memberAuthErr?.message}`);
      }

      const { error: memberInsertErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: memberAuth.user.id,
        role: "member",
        status: "active",
      });
      if (memberInsertErr) {
        throw new Error(`Failed to seed member membership: ${memberInsertErr.message}`);
      }

      // Seed an audit_log row directly via the service-role admin client
      // (bypasses RLS entirely, which is expected/allowed for the admin
      // client — this mirrors how the SECURITY DEFINER RPC would write a
      // row from real application code).
      const { data: seeded, error: seedErr } = await adminClient
        .from("audit_log")
        .insert({
          workspace_id: workspaceId,
          actor_id: ownerUserId,
          action: "project.archived",
          target_type: "project",
          target_id: null,
          metadata: { seeded: true },
        })
        .select("id")
        .single();
      if (seedErr || !seeded) {
        throw new Error(`Failed to seed audit_log row: ${seedErr?.message}`);
      }
      seededRowId = seeded.id;

      ownerClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: ownerSignInErr } = await ownerClient.auth.signInWithPassword({
        email: ownerEmail,
        password: ownerPassword,
      });
      if (ownerSignInErr) {
        throw new Error(`Failed to sign in owner test user: ${ownerSignInErr.message}`);
      }

      memberClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: memberSignInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (memberSignInErr) {
        throw new Error(`Failed to sign in member test user: ${memberSignInErr.message}`);
      }
    });

    afterAll(async () => {
      // Best-effort cleanup so re-runs stay clean. audit_log has no RLS
      // DELETE path even for the admin client's own policies, but the
      // service-role client bypasses RLS entirely, so this still works.
      if (workspaceId) {
        await adminClient.from("audit_log").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
    });

    it("AS-247: an owner's direct SELECT sees the audit_log row for their workspace", async () => {
      const { data, error } = await ownerClient
        .from("audit_log")
        .select("*")
        .eq("workspace_id", workspaceId);
      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.some((row) => row.id === seededRowId)).toBe(true);
    });

    it("AS-247: a regular member's direct query for audit rows is rejected (returns zero rows, not an error)", async () => {
      const { data, error } = await memberClient
        .from("audit_log")
        .select("*")
        .eq("workspace_id", workspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("AS-249: an owner's direct UPDATE attempt on an existing audit_log row, from their own real session, affects zero rows (no UPDATE policy permits it)", async () => {
      const { data, error } = await ownerClient
        .from("audit_log")
        .update({ action: "tampered.action" })
        .eq("id", seededRowId)
        .select("id");
      // With RLS and no matching policy, Supabase either returns an empty
      // result set (0 rows affected) or a permission error, depending on
      // grants — either outcome proves the mutation did not apply.
      expect((data ?? []).length).toBe(0);

      const { data: verify } = await adminClient
        .from("audit_log")
        .select("action")
        .eq("id", seededRowId)
        .single();
      expect(verify?.action).toBe("project.archived");
      void error;
    });

    it("AS-249: an owner's direct DELETE attempt on an existing audit_log row, from their own real session, affects zero rows (no DELETE policy permits it)", async () => {
      const { data, error } = await ownerClient
        .from("audit_log")
        .delete()
        .eq("id", seededRowId)
        .select("id");
      expect((data ?? []).length).toBe(0);

      const { data: verify } = await adminClient
        .from("audit_log")
        .select("id")
        .eq("id", seededRowId)
        .single();
      expect(verify?.id).toBe(seededRowId);
      void error;
    });

    it("write_audit_log_entry RPC inserts a row via an active member's own session and pins actor_id to their own auth.uid()", async () => {
      const { data, error } = await memberClient.rpc("write_audit_log_entry", {
        p_workspace_id: workspaceId,
        p_action: "member.role_changed",
        p_target_type: "workspace_member",
        p_target_id: null,
        p_metadata: { from: "member", to: "member" },
      });
      expect(error).toBeNull();
      expect(data).toBeTruthy();

      const { data: memberAuthData } = await memberClient.auth.getUser();
      const { data: inserted } = await adminClient
        .from("audit_log")
        .select("actor_id, action")
        .eq("workspace_id", workspaceId)
        .eq("action", "member.role_changed")
        .single();
      expect(inserted?.actor_id).toBe(memberAuthData.user?.id);
    });
  },
);
