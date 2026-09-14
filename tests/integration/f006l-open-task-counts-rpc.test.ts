// Integration test for F006l (missions/20260903-portal, M1 remediation,
// round 3 — B2): `get_open_task_counts`
// (supabase/migrations/20260905010000_perf_task_count_rpc.sql, gated by
// supabase/migrations/20260920010000_f006l_bypass_paths.sql).
//
// This RPC predates the mission and had NO authorisation check of any
// kind and no `revoke ... from public`, so EXECUTE defaulted to PUBLIC.
// It also had no notion of `portal_enabled` or `client_visible`, so a
// client of a portal-disabled project — having first enumerated project
// ids through `projects_select_active_members`, which does not exclude
// the `client` role — could call this RPC directly and get back a count
// of every open task in that project, including non-client-visible ones.
//
// Follows the loadDotEnv/skipIf/real-session convention established by
// tests/integration/overdue-count-rpc.test.ts and
// tests/integration/f007-approvals-rls.test.ts — exercises the real RPC
// through real signed-in sessions, not a mock.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedLegacyStatusColumns } from "../helpers/legacy-status-columns";
import {
  createClient as createSupabaseJsClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

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
const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)("get_open_task_counts RPC (F006l: AS-007/B2)", () => {
  let admin: SupabaseClient;
  let memberSession: SupabaseClient;
  let clientSession: SupabaseClient;
  let anonSession: SupabaseClient;

  let workspaceId: string;
  let enabledProjectId: string;
  let disabledProjectId: string;
  let memberId: string;
  let clientId: string;

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const memberEmail = `f006l-otc-member-${suffix}@example.com`;
    const clientEmail = `f006l-otc-client-${suffix}@example.com`;

    const { data: memberAuth, error: memberAuthErr } =
      await admin.auth.admin.createUser({
        email: memberEmail,
        password: PASSWORD,
        email_confirm: true,
      });
    if (memberAuthErr || !memberAuth.user) {
      throw new Error(`member user: ${memberAuthErr?.message}`);
    }
    memberId = memberAuth.user.id;

    const { data: clientAuth, error: clientAuthErr } =
      await admin.auth.admin.createUser({
        email: clientEmail,
        password: PASSWORD,
        email_confirm: true,
      });
    if (clientAuthErr || !clientAuth.user) {
      throw new Error(`client user: ${clientAuthErr?.message}`);
    }
    clientId = clientAuth.user.id;

    const { data: ws, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F006l OTC Workspace", slug: `f006l-otc-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !ws) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = ws.id;

    const { error: memberErr } = await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: memberId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);
    if (memberErr) throw new Error(`membership: ${memberErr.message}`);

    const { data: enabledProject, error: enabledErr } = await admin
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F006l Enabled", portal_enabled: true })
      .select("id")
      .single();
    if (enabledErr || !enabledProject) throw new Error(`enabled project: ${enabledErr?.message}`);
    enabledProjectId = enabledProject.id;

    const { data: disabledProject, error: disabledErr } = await admin
      .from("projects")
      .insert({ workspace_id: workspaceId, name: "F006l Disabled", portal_enabled: false })
      .select("id")
      .single();
    if (disabledErr || !disabledProject) throw new Error(`disabled project: ${disabledErr?.message}`);
    disabledProjectId = disabledProject.id;

    // status_set_v2: the fixtures below use the legacy "todo" name
    // literally, so seed the legacy columns on both projects (pattern A).
    await seedLegacyStatusColumns(admin, enabledProjectId);
    await seedLegacyStatusColumns(admin, disabledProjectId);

    // Two open (non-done) tasks on the disabled project: one client-visible,
    // one not.
    const { error: taskErr } = await admin.from("tasks").insert([
      { project_id: disabledProjectId, title: "Disabled/visible", status: "todo", author_id: memberId, client_visible: true },
      { project_id: disabledProjectId, title: "Disabled/hidden", status: "todo", author_id: memberId, client_visible: false },
      { project_id: enabledProjectId, title: "Enabled/visible", status: "todo", author_id: memberId, client_visible: true },
      { project_id: enabledProjectId, title: "Enabled/hidden", status: "todo", author_id: memberId, client_visible: false },
    ]);
    if (taskErr) throw new Error(`tasks: ${taskErr.message}`);

    memberSession = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: memberSignInErr } = await memberSession.auth.signInWithPassword({
      email: memberEmail,
      password: PASSWORD,
    });
    if (memberSignInErr) throw new Error(`member sign-in: ${memberSignInErr.message}`);

    clientSession = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
    const { error: clientSignInErr } = await clientSession.auth.signInWithPassword({
      email: clientEmail,
      password: PASSWORD,
    });
    if (clientSignInErr) throw new Error(`client sign-in: ${clientSignInErr.message}`);

    anonSession = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
  });

  afterAll(async () => {
    await admin.from("projects").delete().eq("workspace_id", workspaceId);
    await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    if (memberId) await admin.auth.admin.deleteUser(memberId);
    if (clientId) await admin.auth.admin.deleteUser(clientId);
  });

  it("AS-007/B2: an unauthenticated caller gets no rows at all", async () => {
    // `revoke all ... from public; grant execute ... to authenticated`
    // (20260920010000_f006l_bypass_paths.sql /
    // 20260920020000_f006l_open_task_counts_client_branch_fix.sql) means
    // `anon` never reaches the function body's own `v_user_id is null`
    // no-op guard at all -- Postgres denies the call at the grant layer
    // with 42501 before the function runs. That is a stricter outcome
    // than "runs and returns no rows", not a weaker one, and matches the
    // same SQLSTATE 42501 permission-denied convention every other
    // revoke-from-public RPC/predicate in this suite asserts for an
    // anonymous caller (e.g. f025e-guard-hardening.test.ts).
    const { data, error } = await anonSession.rpc("get_open_task_counts", {
      project_ids: [disabledProjectId],
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("42501");
    expect(data).toBeNull();
  });

  it("AS-007/B2: a client of a portal-disabled project gets no row for it, called directly", async () => {
    const { data, error } = await clientSession.rpc("get_open_task_counts", {
      project_ids: [disabledProjectId],
    });
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("AS-007/AS-054: a client of a portal-ENABLED project counts only client_visible open tasks, not the hidden one", async () => {
    const { data, error } = await clientSession.rpc("get_open_task_counts", {
      project_ids: [enabledProjectId],
    });
    expect(error).toBeNull();
    expect(data).toEqual([{ project_id: enabledProjectId, open_count: 1 }]);
  });

  it("regression: a team member still gets the true count for both projects, unfiltered by client_visible", async () => {
    const { data, error } = await memberSession.rpc("get_open_task_counts", {
      project_ids: [enabledProjectId, disabledProjectId],
    });
    expect(error).toBeNull();
    const byProject = new Map((data ?? []).map((row: { project_id: string; open_count: number }) => [row.project_id, Number(row.open_count)]));
    expect(byProject.get(enabledProjectId)).toBe(2);
    expect(byProject.get(disabledProjectId)).toBe(2);
  });
});
