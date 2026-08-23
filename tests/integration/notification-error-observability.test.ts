// F304 (D2/FU-4 scrutiny fix): real-Supabase integration proof that a
// rejected `create_notification` RPC call is actually observed (logged)
// rather than silently swallowed. Same loadDotEnv/skipIf/admin+session-
// client pattern as tests/integration/notification-fanout.test.ts (F207)
// and tests/integration/notification-deleted-target.test.ts (F210).
//
// The real RPC (supabase/migrations/20260823030000_fix_create_notification_
// spoofing.sql) `raise exception`s when the recipient is not an active
// member of the target workspace — this is used here as a genuine,
// naturally-occurring RPC failure (not a mocked stub) to prove the shared
// helper (lib/notifications/create-notification.ts) actually surfaces it.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createNotification } from "@/lib/notifications/create-notification";

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
    "F304: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "createNotification observes a real rejected RPC (F304: D2/FU-4)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let actorClient: SupabaseClient;
    let actorUserId: string;
    const createdUserIds: string[] = [];

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F304 error-observability workspace", slug: `f304-obs-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const email = `f304-actor-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";
      const { data: auth, error: authErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (authErr || !auth.user) throw new Error(`Failed to create actor: ${authErr?.message}`);
      createdUserIds.push(auth.user.id);
      actorUserId = auth.user.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: actorUserId,
        role: "member",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed actor membership: ${memberErr.message}`);

      actorClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await actorClient.auth.signInWithPassword({ email, password });
      if (signInErr) throw new Error(`Failed to sign in actor: ${signInErr.message}`);
    });

    afterAll(async () => {
      if (workspaceId) {
        await adminClient.from("notifications").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      for (const id of createdUserIds) {
        await adminClient.auth.admin.deleteUser(id).catch(() => {});
      }
    });

    let errorSpy: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errorSpy.mockRestore();
    });

    it("test_AS_386_regression_a_real_rejected_create_notification_rpc_is_logged_not_swallowed", async () => {
      // A recipient id that is NOT an active member of `workspaceId`
      // makes the real RPC's own membership check raise, exactly the
      // "membership check failure" failure mode named in the scrutiny
      // finding — a genuine RPC error, not a mocked one.
      const nonMemberUserId = "00000000-0000-0000-0000-000000000000";

      const result = await createNotification(
        actorClient,
        {
          userId: nonMemberUserId,
          workspaceId,
          kind: "mention",
          taskId: "00000000-0000-0000-0000-000000000001",
        },
        "test_AS_386_regression",
      );

      // Non-fatal by design: never throws, resolves with ok: false.
      expect(result.ok).toBe(false);

      // The core regression assertion: the failure was actually observed
      // (logged), not silently dropped.
      expect(errorSpy).toHaveBeenCalled();
      const loggedCall = errorSpy.mock.calls.find((call) =>
        String(call[0]).includes("create_notification"),
      );
      expect(loggedCall).toBeDefined();

      // And confirm no row was actually written for the rejected call.
      const { data: rows } = await adminClient
        .from("notifications")
        .select("id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", nonMemberUserId);
      expect(rows ?? []).toEqual([]);
    });
  },
);
