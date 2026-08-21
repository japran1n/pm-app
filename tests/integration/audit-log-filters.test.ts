// Integration test for F141's `getAuditLogPage` (lib/queries/audit.ts)
// against the real linked Supabase project — AS-248 ("the audit log can
// be filtered by actor and by action type") and the definition of done's
// bounded-window requirement. Mirrors the loadDotEnv/skipIf/mocked-
// `createClient` pattern established by
// tests/integration/list-view-filters.test.ts (F054) and
// tests/integration/rls-audit-log.test.ts (F139).
//
// Uses an owner session throughout (AS-247/read-access is F139's own
// test's job; this file only exercises the filtering/bounding behaviour
// this feature adds on top of an already-permitted read).

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
    "F141: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let ownerClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ownerClient,
}));

// resolvePeople uses the admin client directly (lib/supabase/admin), which
// reads real env vars itself — no mock needed for it here.

describe.skipIf(!haveAdminCreds)("getAuditLogPage filters (F141)", () => {
  let adminClient: SupabaseClient;
  let workspaceId: string;
  let ownerUserId: string;
  let otherActorUserId: string;

  beforeAll(async () => {
    adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const { data: ws, error: wsErr } = await adminClient
      .from("workspaces")
      .insert({ name: "F141 filters workspace", slug: `f141-filters-${uniqueSuffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) {
      throw new Error(`Failed to create workspace: ${wsErr?.message}`);
    }
    workspaceId = ws.id;

    const ownerEmail = `f141-owner-${uniqueSuffix}@example.com`;
    const ownerPassword = "Test-password-1!";
    const { data: ownerAuth, error: ownerAuthErr } =
      await adminClient.auth.admin.createUser({
        email: ownerEmail,
        password: ownerPassword,
        email_confirm: true,
      });
    if (ownerAuthErr || !ownerAuth.user) {
      throw new Error(`Failed to create owner test user: ${ownerAuthErr?.message}`);
    }
    ownerUserId = ownerAuth.user.id;

    const otherEmail = `f141-other-${uniqueSuffix}@example.com`;
    const { data: otherAuth, error: otherAuthErr } =
      await adminClient.auth.admin.createUser({
        email: otherEmail,
        password: "Test-password-1!",
        email_confirm: true,
      });
    if (otherAuthErr || !otherAuth.user) {
      throw new Error(`Failed to create other test user: ${otherAuthErr?.message}`);
    }
    otherActorUserId = otherAuth.user.id;

    const { error: ownerInsertErr } = await adminClient
      .from("workspace_members")
      .insert({
        workspace_id: workspaceId,
        user_id: ownerUserId,
        role: "owner",
        status: "active",
      });
    if (ownerInsertErr) {
      throw new Error(`Failed to seed owner membership: ${ownerInsertErr.message}`);
    }

    // Seed rows: two different actors, two different action types, so the
    // filters have something to actually narrow.
    const { error: seedErr } = await adminClient.from("audit_log").insert([
      {
        workspace_id: workspaceId,
        actor_id: ownerUserId,
        action: "project.created",
        target_type: "project",
        target_id: null,
        metadata: { name: "Owner-created project" },
      },
      {
        workspace_id: workspaceId,
        actor_id: otherActorUserId,
        action: "project.archived",
        target_type: "project",
        target_id: null,
        metadata: {},
      },
      {
        workspace_id: workspaceId,
        actor_id: otherActorUserId,
        action: "project.created",
        target_type: "project",
        target_id: null,
        metadata: { name: "Other-created project" },
      },
    ]);
    if (seedErr) {
      throw new Error(`Failed to seed audit_log rows: ${seedErr.message}`);
    }

    ownerClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: signInErr } = await ownerClient.auth.signInWithPassword({
      email: ownerEmail,
      password: ownerPassword,
    });
    if (signInErr) {
      throw new Error(`Failed to sign in owner test user: ${signInErr.message}`);
    }
  });

  afterAll(async () => {
    if (workspaceId) {
      await adminClient.from("audit_log").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
    }
  });

  it("AS-248: with no filters, all rows for the workspace are returned", async () => {
    const { getAuditLogPage } = await import("@/lib/queries/audit");
    const page = await getAuditLogPage(workspaceId, {});
    expect(page.rows.length).toBe(3);
    expect(page.hasMore).toBe(false);
  });

  it("AS-248: filtering by actorId returns only that actor's rows", async () => {
    const { getAuditLogPage } = await import("@/lib/queries/audit");
    const page = await getAuditLogPage(workspaceId, { actorId: otherActorUserId });
    expect(page.rows.length).toBe(2);
    expect(page.rows.every((r) => r.actorId === otherActorUserId)).toBe(true);
  });

  it("AS-248: filtering by action returns only rows of that action type", async () => {
    const { getAuditLogPage } = await import("@/lib/queries/audit");
    const page = await getAuditLogPage(workspaceId, { action: "project.created" });
    expect(page.rows.length).toBe(2);
    expect(page.rows.every((r) => r.action === "project.created")).toBe(true);
  });

  it("AS-248: actor and action filters combine (AND)", async () => {
    const { getAuditLogPage } = await import("@/lib/queries/audit");
    const page = await getAuditLogPage(workspaceId, {
      actorId: otherActorUserId,
      action: "project.archived",
    });
    expect(page.rows.length).toBe(1);
    expect(page.rows[0]!.actorId).toBe(otherActorUserId);
    expect(page.rows[0]!.action).toBe("project.archived");
  });

  it("bounded window: a limit smaller than the row count reports hasMore=true and returns exactly `limit` rows", async () => {
    const { getAuditLogPage } = await import("@/lib/queries/audit");
    const page = await getAuditLogPage(workspaceId, {}, 2);
    expect(page.rows.length).toBe(2);
    expect(page.hasMore).toBe(true);
  });
});
