// Integration tests for F208's mark-read / mark-all-read Server Actions
// (AS-386, AS-387) — run against the real linked Supabase project, same
// loadDotEnv/skipIf/admin+session-client pattern as
// tests/integration/rls-notifications.test.ts (F206).
//
// These exercise lib/actions/notifications.ts directly (not just the raw
// table UPDATE F206 already proved RLS-respecting) — actAsUser mocks
// lib/supabase/server's createClient so the action runs under a real
// signed-in session, same convention as other Server-Action integration
// tests in this suite (e.g. tests/integration/comment-reactions-*).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    "F208: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let activeSessionClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "notification mark-read Server Actions (F208: AS-386, AS-387)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let recipientUserId: string;
    let recipientSessionClient: SupabaseClient;
    let otherUserId: string;
    let otherSessionClient: SupabaseClient;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F208 notifications workspace", slug: `f208-notif-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const recipientEmail = `f208-recipient-${uniqueSuffix}@example.com`;
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

      const otherEmail = `f208-other-${uniqueSuffix}@example.com`;
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
    });

    afterAll(async () => {
      if (workspaceId) {
        await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
    });

    it("test_AS_386_markNotificationRead_marks_the_callers_own_notification_read", async () => {
      const { data: created, error: createErr } = await adminClient.rpc("create_notification", {
        p_user_id: recipientUserId,
        p_workspace_id: workspaceId,
        p_kind: "mention",
        p_actor_id: otherUserId,
        p_system: true,
      });
      if (createErr || !created) {
        throw new Error(`Failed to seed notification: ${createErr?.message}`);
      }
      const notificationId = (created as { id: string }).id;

      activeSessionClient = recipientSessionClient;
      const { markNotificationRead } = await import("@/lib/actions/notifications");
      const result = await markNotificationRead(notificationId);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("notifications")
        .select("read_at")
        .eq("id", notificationId)
        .single();
      expect(row?.read_at).not.toBeNull();
    });

    it("test_AS_386_negative_markNotificationRead_cannot_mark_someone_elses_notification_read", async () => {
      const { data: created, error: createErr } = await adminClient.rpc("create_notification", {
        p_user_id: recipientUserId,
        p_workspace_id: workspaceId,
        p_kind: "mention",
        p_actor_id: otherUserId,
        p_system: true,
      });
      if (createErr || !created) {
        throw new Error(`Failed to seed notification: ${createErr?.message}`);
      }
      const notificationId = (created as { id: string }).id;

      // otherSessionClient tries to mark RECIPIENT's own notification read.
      activeSessionClient = otherSessionClient;
      const { markNotificationRead } = await import("@/lib/actions/notifications");
      const result = await markNotificationRead(notificationId);
      expect(result.ok).toBe(false);

      const { data: row } = await adminClient
        .from("notifications")
        .select("read_at")
        .eq("id", notificationId)
        .single();
      expect(row?.read_at).toBeNull();
    });

    it("test_AS_387_markAllNotificationsRead_clears_every_unread_notification_for_the_caller_in_that_workspace", async () => {
      const seeds = await Promise.all(
        [1, 2, 3].map(() =>
          adminClient.rpc("create_notification", {
            p_user_id: recipientUserId,
            p_workspace_id: workspaceId,
            p_kind: "task_due_soon",
            p_system: true,
          }),
        ),
      );
      for (const { error } of seeds) {
        if (error) throw new Error(`Failed to seed notification: ${error.message}`);
      }

      activeSessionClient = recipientSessionClient;
      const { markAllNotificationsRead } = await import("@/lib/actions/notifications");
      const result = await markAllNotificationsRead(workspaceId);
      expect(result.ok).toBe(true);

      const { data: rows } = await adminClient
        .from("notifications")
        .select("read_at")
        .eq("workspace_id", workspaceId)
        .eq("user_id", recipientUserId);
      expect((rows ?? []).every((row) => row.read_at !== null)).toBe(true);
    });

    it("test_AS_387_negative_markAllNotificationsRead_does_not_touch_another_members_notifications", async () => {
      const { data: created, error: createErr } = await adminClient.rpc("create_notification", {
        p_user_id: otherUserId,
        p_workspace_id: workspaceId,
        p_kind: "task_due_soon",
        p_system: true,
      });
      if (createErr || !created) {
        throw new Error(`Failed to seed notification: ${createErr?.message}`);
      }
      const otherNotificationId = (created as { id: string }).id;

      activeSessionClient = recipientSessionClient;
      const { markAllNotificationsRead } = await import("@/lib/actions/notifications");
      const result = await markAllNotificationsRead(workspaceId);
      expect(result.ok).toBe(true);

      const { data: row } = await adminClient
        .from("notifications")
        .select("read_at")
        .eq("id", otherNotificationId)
        .single();
      expect(row?.read_at).toBeNull();
    });
  },
);
