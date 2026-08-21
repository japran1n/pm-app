// F140: writeAudit() helper + wiring into workspace/project/member/role
// mutations (AS-245 — "workspace, project, member, and role mutations each
// write an entry with actor, action, target, timestamp").
//
// Two layers of evidence, per this feature's clarified Definition of done:
//
//  1. A unit test on `writeAudit()` in isolation — proves the helper calls
//     the `write_audit_log_entry` RPC with the right payload shape, and
//     that a failed/throwing RPC call never propagates (matches the
//     non-fatal `revalidatePath`-failure convention used throughout
//     lib/actions/*.ts).
//  2. An integration test that a real, representative action —
//     `changeMemberRole` (F129) — produces exactly one row in the live
//     `audit_log` table when called for real against the linked Supabase
//     project, verified via the admin client afterward.
//
// The integration half skips (rather than fails) when Supabase credentials
// aren't present, mirroring every other integration test in this suite
// (tests/integration/rls-audit-log.test.ts, tests/integration/
// change-member-role.test.ts).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

// --- 1. Unit test: writeAudit()'s payload shape, in isolation ------------

describe("writeAudit() (F140, AS-245) — payload shape and non-fatal failure handling", () => {
  it("AS-245: calls write_audit_log_entry with the exact RPC param shape (p_workspace_id, p_action, p_target_type, p_target_id, p_metadata)", async () => {
    const { writeAudit } = await import("@/lib/activity/audit");

    const rpc = vi.fn().mockResolvedValue({ data: { id: "row-1" }, error: null });
    const fakeClient = { rpc } as unknown as Parameters<typeof writeAudit>[0];

    await writeAudit(fakeClient, {
      workspaceId: "ws-1",
      action: "member.role_changed",
      targetType: "workspace_member",
      targetId: "member-1",
      metadata: { old_role: "member", new_role: "admin" },
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("write_audit_log_entry", {
      p_workspace_id: "ws-1",
      p_action: "member.role_changed",
      p_target_type: "workspace_member",
      p_target_id: "member-1",
      p_metadata: { old_role: "member", new_role: "admin" },
    });
  });

  it("defaults targetId to null and metadata to {} when omitted", async () => {
    const { writeAudit } = await import("@/lib/activity/audit");

    const rpc = vi.fn().mockResolvedValue({ data: { id: "row-2" }, error: null });
    const fakeClient = { rpc } as unknown as Parameters<typeof writeAudit>[0];

    await writeAudit(fakeClient, {
      workspaceId: "ws-1",
      action: "workspace.deleted",
      targetType: "workspace",
    });

    expect(rpc).toHaveBeenCalledWith("write_audit_log_entry", {
      p_workspace_id: "ws-1",
      p_action: "workspace.deleted",
      p_target_type: "workspace",
      p_target_id: null,
      p_metadata: {},
    });
  });

  it("a failed RPC call (error returned) is logged but does not throw", async () => {
    const { writeAudit } = await import("@/lib/activity/audit");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: "audit_log: caller is not an active member of this workspace" },
    });
    const fakeClient = { rpc } as unknown as Parameters<typeof writeAudit>[0];

    await expect(
      writeAudit(fakeClient, {
        workspaceId: "ws-1",
        action: "member.removed",
        targetType: "workspace_member",
        targetId: "member-2",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("an unexpected throw from the RPC call (e.g. no rpc method / no session context) is caught, logged, and never propagates", async () => {
    const { writeAudit } = await import("@/lib/activity/audit");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const rpc = vi.fn().mockRejectedValue(new Error("network error"));
    const fakeClient = { rpc } as unknown as Parameters<typeof writeAudit>[0];

    await expect(
      writeAudit(fakeClient, {
        workspaceId: "ws-1",
        action: "project.archived",
        targetType: "project",
        targetId: "project-1",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});

// --- 2. Integration test: a real action produces exactly one audit_log row -

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveAdminCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveAdminCreds) {
  throw new Error(
    "F140: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

// changeMemberRole's own createClient() call must resolve to a real,
// signed-in session client (not just an object with a fake getUser()) so
// that writeAudit's `supabase.rpc("write_audit_log_entry", ...)` call runs
// against the caller's real auth.uid() — the RPC requires it. This module-
// level mock is populated with a real signed-in SupabaseClient in
// beforeAll below.
let sessionClientForMock: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => sessionClientForMock,
}));

describe.skipIf(!haveAdminCreds)(
  "changeMemberRole writes exactly one audit_log row (F140, AS-245)",
  () => {
    let adminClient: SupabaseClient;
    let ownerClient: SupabaseClient;
    let workspaceId: string;
    let ownerUserId: string;
    let targetMembershipId: string;

    beforeAll(async () => {
      adminClient = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F140 audit workspace", slug: `f140-audit-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create test workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      const ownerEmail = `f140-owner-${uniqueSuffix}@example.com`;
      const ownerPassword = "Test-password-1!";
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

      const { data: targetAuth, error: targetAuthErr } = await adminClient.auth.admin.createUser({
        email: `f140-target-${uniqueSuffix}@example.com`,
        password: "Test-password-1!",
        email_confirm: true,
      });
      if (targetAuthErr || !targetAuth.user) {
        throw new Error(`Failed to create target test user: ${targetAuthErr?.message}`);
      }

      const { data: targetMembership, error: targetInsertErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: targetAuth.user.id,
          role: "member",
          status: "active",
        })
        .select("id")
        .single();
      if (targetInsertErr || !targetMembership) {
        throw new Error(`Failed to seed target membership: ${targetInsertErr?.message}`);
      }
      targetMembershipId = targetMembership.id;

      ownerClient = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await ownerClient.auth.signInWithPassword({
        email: ownerEmail,
        password: ownerPassword,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in owner test user: ${signInErr.message}`);
      }
    });

    beforeEach(() => {
      sessionClientForMock = ownerClient;
    });

    afterAll(async () => {
      if (workspaceId) {
        await adminClient.from("audit_log").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
    });

    it("AS-245: changing a member's role writes exactly one audit_log row with actor, action, target, and timestamp set correctly", async () => {
      const { changeMemberRole } = await import("@/lib/actions/workspaces");

      const result = await changeMemberRole(workspaceId, targetMembershipId, "admin");
      expect(result).toEqual({ ok: true });

      const { data: rows, error } = await adminClient
        .from("audit_log")
        .select("actor_id, action, target_type, target_id, workspace_id, created_at")
        .eq("workspace_id", workspaceId)
        .eq("action", "member.role_changed");

      expect(error).toBeNull();
      expect(rows).toHaveLength(1);

      const row = rows![0];
      expect(row.actor_id).toBe(ownerUserId);
      expect(row.action).toBe("member.role_changed");
      expect(row.target_type).toBe("workspace_member");
      expect(row.target_id).toBe(targetMembershipId);
      expect(row.workspace_id).toBe(workspaceId);
      expect(row.created_at).toBeTruthy();
    });
  },
);
