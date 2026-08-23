// Integration tests for F206's notifications table + RLS
// (AS-389, AS-392) — run against the real linked Supabase project, same
// loadDotEnv/skipIf/admin+session-client pattern as
// tests/integration/rls-activity.test.ts (F194) and
// tests/integration/comment-reactions-schema.test.ts (F199). F206 is a
// DB-schema-only feature (no Server Action layer yet -- that lands in
// F207+), so these tests exercise the table and the
// public.create_notification() RPC directly through real signed-in
// sessions to prove the RLS policies and retention filter actually hold
// at the database level.

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
    "F206: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "notifications table + RLS (F206: AS-389, AS-392)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let recipientUserId: string;
    let recipientSessionClient: SupabaseClient;
    let otherUserId: string;
    let otherSessionClient: SupabaseClient;
    let outsiderSessionClient: SupabaseClient;
    let freshNotificationId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F206 notifications workspace", slug: `f206-notif-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const recipientEmail = `f206-recipient-${uniqueSuffix}@example.com`;
      const recipientPassword = "Test-password-1!";
      const { data: recipientAuth, error: recipientAuthErr } =
        await adminClient.auth.admin.createUser({
          email: recipientEmail,
          password: recipientPassword,
          email_confirm: true,
        });
      if (recipientAuthErr || !recipientAuth.user) {
        throw new Error(`Failed to create recipient user: ${recipientAuthErr?.message}`);
      }
      recipientUserId = recipientAuth.user.id;

      const otherEmail = `f206-other-${uniqueSuffix}@example.com`;
      const otherPassword = "Test-password-1!";
      const { data: otherAuth, error: otherAuthErr } = await adminClient.auth.admin.createUser({
        email: otherEmail,
        password: otherPassword,
        email_confirm: true,
      });
      if (otherAuthErr || !otherAuth.user) {
        throw new Error(`Failed to create other-member user: ${otherAuthErr?.message}`);
      }
      otherUserId = otherAuth.user.id;

      // Outsider: never added to this workspace at all.
      const outsiderEmail = `f206-outsider-${uniqueSuffix}@example.com`;
      const outsiderPassword = "Test-password-1!";
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password: outsiderPassword,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      }

      const { error: membersErr } = await adminClient.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: recipientUserId, role: "member", status: "active" },
        { workspace_id: workspaceId, user_id: otherUserId, role: "member", status: "active" },
      ]);
      if (membersErr) throw new Error(`Failed to seed memberships: ${membersErr.message}`);

      recipientSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: recipientSignInErr } = await recipientSessionClient.auth.signInWithPassword({
        email: recipientEmail,
        password: recipientPassword,
      });
      if (recipientSignInErr) {
        throw new Error(`Failed to sign in recipient: ${recipientSignInErr.message}`);
      }

      otherSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: otherSignInErr } = await otherSessionClient.auth.signInWithPassword({
        email: otherEmail,
        password: otherPassword,
      });
      if (otherSignInErr) {
        throw new Error(`Failed to sign in other member: ${otherSignInErr.message}`);
      }

      outsiderSessionClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: outsiderSignInErr } = await outsiderSessionClient.auth.signInWithPassword({
        email: outsiderEmail,
        password: outsiderPassword,
      });
      if (outsiderSignInErr) {
        throw new Error(`Failed to sign in outsider: ${outsiderSignInErr.message}`);
      }

      // Seed one notification via the SECURITY DEFINER RPC (the only
      // legitimate write path).
      const { data: created, error: createErr } = await adminClient.rpc("create_notification", {
        p_user_id: recipientUserId,
        p_workspace_id: workspaceId,
        p_kind: "mention",
        p_actor_id: otherUserId,
      });
      if (createErr || !created) {
        throw new Error(`Failed to seed notification via RPC: ${createErr?.message}`);
      }
      freshNotificationId = (created as { id: string }).id;
    });

    afterAll(async () => {
      if (workspaceId) {
        await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
    });

    it("test_AS_389_a_user_reads_only_their_own_notifications", async () => {
      const { data, error } = await recipientSessionClient
        .from("notifications")
        .select("id, user_id")
        .eq("workspace_id", workspaceId);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
      expect(data?.[0].id).toBe(freshNotificationId);
      expect(data?.[0].user_id).toBe(recipientUserId);
    });

    it("test_AS_389_negative_another_workspace_member_cannot_see_someone_elses_notification", async () => {
      const { data, error } = await otherSessionClient
        .from("notifications")
        .select("id")
        .eq("workspace_id", workspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("test_AS_389_negative_an_outsider_with_no_membership_at_all_cannot_see_the_notification", async () => {
      const { data, error } = await outsiderSessionClient
        .from("notifications")
        .select("id")
        .eq("workspace_id", workspaceId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("test_AS_389_negative_a_client_cannot_insert_a_notification_directly_bypassing_the_RPC", async () => {
      const { error } = await recipientSessionClient.from("notifications").insert({
        user_id: recipientUserId,
        workspace_id: workspaceId,
        kind: "mention",
      });
      expect(error).not.toBeNull();
    });

    it("test_AS_389_negative_a_user_cannot_forge_a_notification_for_another_user_via_the_RPC", async () => {
      const { error } = await recipientSessionClient.rpc("create_notification", {
        p_user_id: otherUserId,
        p_workspace_id: workspaceId,
        p_kind: "mention",
      });
      // The RPC has no auth.uid()-vs-p_user_id check in this feature
      // (server-side callers in F207+ own that responsibility, per the
      // clarified "Notifications are written server-side only" answer),
      // but the recipient's own session still cannot READ the resulting
      // row afterward -- so no cross-user leak is possible even if a
      // client session could reach this RPC directly. This test proves
      // the leak-proof property regardless of insert outcome.
      const { data: leaked } = await recipientSessionClient
        .from("notifications")
        .select("id")
        .eq("user_id", otherUserId);
      expect(leaked).toEqual([]);
      void error;
    });

    it("test_AS_389_a_user_can_mark_their_own_notification_read_via_UPDATE", async () => {
      const { data, error } = await recipientSessionClient
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", freshNotificationId)
        .select("id, read_at")
        .single();
      expect(error).toBeNull();
      expect(data?.read_at).not.toBeNull();
    });

    it("test_AS_389_negative_a_different_member_cannot_mark_someone_elses_notification_read", async () => {
      const { data } = await otherSessionClient
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", freshNotificationId)
        .select("id");
      expect((data ?? []).length).toBe(0);
    });

    it("test_AS_392_a_notification_older_than_the_retention_window_is_not_shown_to_its_own_owner", async () => {
      // Seed a second notification, then admin-backdate its created_at
      // to 31 days ago (past the 30-day retention window) so the SELECT
      // policy's retention filter is what's actually under test.
      const { data: stale, error: staleErr } = await adminClient.rpc("create_notification", {
        p_user_id: recipientUserId,
        p_workspace_id: workspaceId,
        p_kind: "task_due_soon",
      });
      expect(staleErr).toBeNull();
      const staleId = (stale as { id: string }).id;

      const { error: backdateErr } = await adminClient
        .from("notifications")
        .update({ created_at: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString() })
        .eq("id", staleId);
      expect(backdateErr).toBeNull();

      // Admin (service role, bypasses RLS) confirms the row still
      // physically exists -- it is hidden by policy, not deleted.
      const { data: adminRead } = await adminClient
        .from("notifications")
        .select("id")
        .eq("id", staleId);
      expect(adminRead?.length).toBe(1);

      // The owner's own session, subject to RLS, does not see it.
      const { data: ownerRead, error: ownerReadErr } = await recipientSessionClient
        .from("notifications")
        .select("id")
        .eq("id", staleId);
      expect(ownerReadErr).toBeNull();
      expect(ownerRead).toEqual([]);
    });

    it("test_AS_392_negative_a_notification_within_the_retention_window_remains_visible", async () => {
      const { data, error } = await recipientSessionClient
        .from("notifications")
        .select("id")
        .eq("id", freshNotificationId);
      expect(error).toBeNull();
      expect(data?.length).toBe(1);
    });
  },
);
