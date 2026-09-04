// F025e (missions/20260903-portal, M5 final remediation) — the two
// "small" items from the same audit as the double-guarded portal reads:
//
//   1. looks_like_credential (public.looks_like_credential, called from
//      the project_links/project_accounts CHECK constraints) had no
//      explicit `authenticated` EXECUTE grant. F016i's event trigger
//      (20261007010000, live before looks_like_credential's first
//      creation at 20261014010000) revoked EXECUTE from public, anon
//      AND authenticated on its first creation, and 20261014020000's
//      `create or replace function` preserved that revoked ACL. Every
//      write today goes through the service-role client, so this was
//      never observed — but the first authenticated-role write to
//      project_accounts/project_links would have hit a bare
//      "permission denied for function" instead of the CHECK's own
//      constraint-violation error. 20261023010000 grants `authenticated`
//      EXECUTE; this suite proves both the grant (catalog) and the
//      resulting error shape (a real authenticated insert).
//
//   2. client_requests_client_read (F025b, 20261018010000) is a
//      `security_invoker = true` view — load-bearing, per that
//      migration's own comment, because the masking it performs relies
//      on RLS evaluating under the CALLING user, not the view owner.
//      Nothing before this suite asserted that flag from the catalog: a
//      future `create or replace view` that dropped `security_invoker`
//      would still look correct (the masking predicate is unchanged in
//      the view's own SQL) while silently losing the property that
//      makes it correct.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const haveRestCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
const haveMgmtCreds = Boolean(PROJECT_REF && ACCESS_TOKEN);
const haveCreds = haveRestCreds && haveMgmtCreds;

if (process.env.CI && !haveCreds) {
  throw new Error(
    "F025e: missing Supabase credentials (REST + Management API) required to run this suite in CI.",
  );
}

async function mgmtSql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`F025e mgmt SQL failed (${res.status}): ${JSON.stringify(body)}`);
  }
  return body as T[];
}

const PASSWORD = "Test-password-1!";

describe.skipIf(!haveCreds)("F025e: looks_like_credential EXECUTE grant and view security_invoker", () => {
  it("catalog: authenticated has EXECUTE on public.looks_like_credential(text)", async () => {
    const rows = await mgmtSql<{ authenticated_exec: boolean; anon_exec: boolean }>(`
      select
        has_function_privilege('authenticated', 'public.looks_like_credential(text)', 'EXECUTE') as authenticated_exec,
        has_function_privilege('anon', 'public.looks_like_credential(text)', 'EXECUTE') as anon_exec;
    `);
    expect(rows[0]?.authenticated_exec).toBe(true);
    // Never widen to anon -- only authenticated needs it (every write
    // path requires a signed-in session already).
    expect(rows[0]?.anon_exec).toBe(false);
  });

  it("catalog: public.client_requests_client_read carries security_invoker = true", async () => {
    const rows = await mgmtSql<{ reloptions: string[] | null }>(`
      select reloptions
      from pg_class
      where relname = 'client_requests_client_read' and relkind = 'v';
    `);
    expect(rows).toHaveLength(1);
    const reloptions = rows[0]?.reloptions ?? [];
    expect(
      reloptions,
      `client_requests_client_read.reloptions did not carry security_invoker=true: ${JSON.stringify(reloptions)}`,
    ).toContain("security_invoker=true");
  });

  describe("manual verification: authenticated write reaches the constraint, not a permission error", () => {
    let admin: SupabaseClient;
    let ownerSession: SupabaseClient;

    let workspaceId: string;
    let projectId: string;
    let ownerId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ownerData, error: ownerErr } = await admin.auth.admin.createUser({
        email: `f025e-owner-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (ownerErr || !ownerData.user) throw new Error(`owner: ${ownerErr?.message}`);
      ownerId = ownerData.user.id;
      createdUserIds.push(ownerId);

      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F025e guard test", slug: `f025e-guard-${suffix}` })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin
        .from("workspace_members")
        .insert({ workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" });

      const { data: project, error: projErr } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F025e guard project",
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: true,
        })
        .select("id")
        .single();
      if (projErr || !project) throw new Error(`project: ${projErr?.message}`);
      projectId = project.id;

      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInError } = await session.auth.signInWithPassword({
        email: ownerData.user.email!,
        password: PASSWORD,
      });
      if (signInError) throw new Error(`sign in owner: ${signInError.message}`);
      ownerSession = session;
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("project_accounts").delete().eq("project_id", projectId);
      await admin.from("projects").delete().eq("id", projectId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    it("an authenticated team-member insert with a credential-shaped service value fails the CHECK, not a permission error", async () => {
      const { error } = await ownerSession.from("project_accounts").insert({
        project_id: projectId,
        service: "sk_live_1234567890abcdef",
        owner: "agency",
        status: "pending",
      });

      expect(error).not.toBeNull();
      // Postgres reports a permission-denied failure as SQLSTATE 42501
      // and a CHECK violation as 23514 -- this is the exact distinction
      // the missing grant would have collapsed.
      expect(error?.code).toBe("23514");
      expect(error?.message.toLowerCase()).not.toContain("permission denied");
    });

    it("the same authenticated team-member insert with an ordinary service value succeeds", async () => {
      const { error } = await ownerSession.from("project_accounts").insert({
        project_id: projectId,
        service: "Domain registrar",
        owner: "agency",
        status: "pending",
      });
      expect(error).toBeNull();
    });
  });
});
