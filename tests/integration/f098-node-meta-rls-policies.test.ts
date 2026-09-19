// F098 (missions/20260919-150607, follow-up from M5-scrutiny-1.md FU-4):
// live regression test for the four team RLS policies on
// architecture_node_meta. F033 dropped only the client SELECT policy
// (architecture_node_meta_select_client) after confirming 0 true rows for
// client_visible. Nothing previously asserted that the four team policies
// (select_team, insert_team, update_team, delete_team) stayed intact — a
// rewrite of select_team or a silent drop of insert/update/delete_team would
// leave the suite green.
//
// AS-122: the four team policies on architecture_node_meta exist with their
// original expressions, and the client SELECT policy stays gone.
//
// Expected expressions were read directly from the live database via
// pg_get_expr(polqual, polrelid) / pg_get_expr(polwithcheck, polrelid) on
// 2026-09-19 (Supabase Management API database/query endpoint), matching the
// definitions in supabase/migrations/20261127021000_architecture_node_meta.sql
// after 20261127140000_drop_node_meta_client_visible.sql removed
// select_client:
//
//   architecture_node_meta_select_team:
//     USING (is_project_visible_to(project_id) AND (NOT is_project_client(project_id)))
//   architecture_node_meta_insert_team:
//     WITH CHECK is_project_workspace_writer(project_id)
//   architecture_node_meta_update_team:
//     USING is_project_workspace_writer(project_id)
//     WITH CHECK is_project_workspace_writer(project_id)
//   architecture_node_meta_delete_team:
//     USING is_project_workspace_writer(project_id)

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
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
const SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const haveCreds = Boolean(
  SUPABASE_URL && SECRET_KEY && ACCESS_TOKEN && PROJECT_REF,
);

if (process.env.CI && !haveCreds) {
  throw new Error(
    "Missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF as GitHub Actions repository secrets.",
  );
}

type PolicyRow = {
  polname: string;
  using_expr: string | null;
  check_expr: string | null;
};

async function queryPolicies(): Promise<PolicyRow[]> {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query:
          "SELECT polname, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr " +
          "FROM pg_catalog.pg_policy p " +
          "JOIN pg_catalog.pg_class c ON c.oid = p.polrelid " +
          "WHERE c.relname = 'architecture_node_meta' " +
          "ORDER BY polname;",
      }),
    },
  );

  if (!res.ok) {
    throw new Error(
      `Supabase Management API query failed: ${res.status} ${await res.text()}`,
    );
  }

  return (await res.json()) as PolicyRow[];
}

describe.skipIf(!haveCreds)(
  "AS-122 (live): architecture_node_meta team RLS policies stay intact",
  () => {
    let policies: PolicyRow[];
    let byName: Map<string, PolicyRow>;
    let admin: SupabaseClient;

    it("fetches the live policy list for architecture_node_meta", async () => {
      policies = await queryPolicies();
      byName = new Map(policies.map((p) => [p.polname, p]));
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      expect(admin).toBeDefined();
      expect(policies.length).toBeGreaterThan(0);
    });

    it("architecture_node_meta_select_team exists with the expected USING expression", () => {
      const policy = byName.get("architecture_node_meta_select_team");
      expect(policy).toBeDefined();
      expect(policy?.using_expr).toBe(
        "(is_project_visible_to(project_id) AND (NOT is_project_client(project_id)))",
      );
    });

    it("architecture_node_meta_insert_team exists with the expected WITH CHECK expression", () => {
      const policy = byName.get("architecture_node_meta_insert_team");
      expect(policy).toBeDefined();
      expect(policy?.check_expr).toBe("is_project_workspace_writer(project_id)");
    });

    it("architecture_node_meta_update_team exists with the expected USING and WITH CHECK expressions", () => {
      const policy = byName.get("architecture_node_meta_update_team");
      expect(policy).toBeDefined();
      expect(policy?.using_expr).toBe("is_project_workspace_writer(project_id)");
      expect(policy?.check_expr).toBe("is_project_workspace_writer(project_id)");
    });

    it("architecture_node_meta_delete_team exists with the expected USING expression", () => {
      const policy = byName.get("architecture_node_meta_delete_team");
      expect(policy).toBeDefined();
      expect(policy?.using_expr).toBe("is_project_workspace_writer(project_id)");
    });

    it("architecture_node_meta_select_client no longer exists (dropped by F033)", () => {
      expect(byName.get("architecture_node_meta_select_client")).toBeUndefined();
    });
  },
);
