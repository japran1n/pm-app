// F211: real-Supabase RLS coverage for notification_preferences
// (AS-391, AS-396). Pattern mirrors tests/integration/rls-notifications.test.ts
// (F206): loadDotEnv/skipIf/admin+session-client, one workspace/user set
// per suite run.

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
    "F211: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "notification_preferences table + RLS (F211: AS-391, AS-396)",
  () => {
    let adminClient: SupabaseClient;
    let userAId: string;
    let sessionA: SupabaseClient;
    let userBId: string;
    let sessionB: SupabaseClient;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      async function createUser(label: string) {
        const email = `f211-${label}-${uniqueSuffix}@example.com`;
        const password = "Test-password-1!";
        const { data: auth, error: authErr } = await adminClient.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
        if (authErr || !auth.user) throw new Error(`Failed to create ${label}: ${authErr?.message}`);
        createdUserIds.push(auth.user.id);
        const client = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
        const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
        if (signInErr) throw new Error(`Failed to sign in ${label}: ${signInErr.message}`);
        return { userId: auth.user.id, client };
      }

      const a = await createUser("a");
      userAId = a.userId;
      sessionA = a.client;

      const b = await createUser("b");
      userBId = b.userId;
      sessionB = b.client;
    });

    afterAll(async () => {
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    it("test_AS_391_a_new_user_gets_a_default_preferences_row_via_the_signup_trigger", async () => {
      const { data, error } = await adminClient
        .from("notification_preferences")
        .select(
          "mention_in_app, task_assigned_in_app, comment_reply_in_app, watcher_update_in_app, comment_reply_email, watcher_update_email, email_enabled",
        )
        .eq("user_id", userAId)
        .single();
      expect(error).toBeNull();
      // Sensible-defaults (this feature's Notes): kinds that name/target
      // the user default on for both channels is asserted in the unit
      // test for mention/task_assigned; this asserts the "not spammy on
      // day one" half — broad activity-stream kinds default to in-app on,
      // email off.
      expect(data?.mention_in_app).toBe(true);
      expect(data?.task_assigned_in_app).toBe(true);
      expect(data?.comment_reply_in_app).toBe(true);
      expect(data?.watcher_update_in_app).toBe(true);
      expect(data?.comment_reply_email).toBe(false);
      expect(data?.watcher_update_email).toBe(false);
      // AS-396: email is enabled by default (a user must explicitly turn
      // it off).
      expect(data?.email_enabled).toBe(true);
    });

    it("test_AS_391_a_user_reads_only_their_own_preferences_row", async () => {
      const { data, error } = await sessionA
        .from("notification_preferences")
        .select("user_id")
        .eq("user_id", userAId);
      expect(error).toBeNull();
      expect(data).toHaveLength(1);
    });

    it("test_AS_391_negative_a_user_cannot_read_another_users_preferences_row", async () => {
      const { data, error } = await sessionA
        .from("notification_preferences")
        .select("user_id")
        .eq("user_id", userBId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("test_AS_391_a_user_configures_which_notification_types_they_receive_by_updating_their_own_row", async () => {
      const { data, error } = await sessionA
        .from("notification_preferences")
        .update({ mention_in_app: false })
        .eq("user_id", userAId)
        .select("mention_in_app")
        .single();
      expect(error).toBeNull();
      expect(data?.mention_in_app).toBe(false);

      // Round-trips.
      const { data: reread } = await sessionA
        .from("notification_preferences")
        .select("mention_in_app")
        .eq("user_id", userAId)
        .single();
      expect(reread?.mention_in_app).toBe(false);
    });

    it("test_AS_391_negative_a_user_cannot_update_another_users_preferences_row", async () => {
      const { data } = await sessionA
        .from("notification_preferences")
        .update({ mention_in_app: false })
        .eq("user_id", userBId)
        .select("user_id");
      expect((data ?? []).length).toBe(0);

      // Confirm B's row was actually untouched.
      const { data: bRow } = await adminClient
        .from("notification_preferences")
        .select("mention_in_app")
        .eq("user_id", userBId)
        .single();
      expect(bRow?.mention_in_app).toBe(true);
    });

    it("test_AS_396_a_user_can_turn_email_off_entirely_and_it_persists_and_round_trips", async () => {
      const { data, error } = await sessionB
        .from("notification_preferences")
        .update({ email_enabled: false })
        .eq("user_id", userBId)
        .select("email_enabled")
        .single();
      expect(error).toBeNull();
      expect(data?.email_enabled).toBe(false);

      const { data: reread } = await sessionB
        .from("notification_preferences")
        .select("email_enabled")
        .eq("user_id", userBId)
        .single();
      expect(reread?.email_enabled).toBe(false);
    });
  },
);
