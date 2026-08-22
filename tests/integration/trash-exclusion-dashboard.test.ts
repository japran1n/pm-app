// F193 (AS-350): systematic sweep — dedicated per-surface trash-exclusion
// test for the Dashboard surface (see this feature's own explicit "one
// integration test per surface" instruction).
//
// The dashboard's three aggregate RPCs (get_priority_counts,
// get_status_counts, get_overdue_count) all now select from the shared
// `active_project_tasks` view introduced by F144
// (supabase/migrations/20260822010000_active_project_tasks_view_and_time_report_fix.sql),
// whose definition includes `t.deleted_at is null` — this test proves the
// trash-exclusion half of that predicate holds end-to-end for the
// dashboard's priority-count tile, via the real getPriorityCounts wrapper
// (lib/queries/dashboard.ts), against the real linked Supabase project.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

describe.skipIf(!haveAdminCreds)(
  "getPriorityCounts (dashboard) trash exclusion (F193: AS-350)",
  () => {
    let adminClient: SupabaseClient;
    let memberClient: SupabaseClient;
    let projectId: string;
    let workspaceId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f193-dash-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(`Failed to create test user: ${memberAuthErr?.message}`);
      }
      memberUserId = memberAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({ name: "F193 Dashboard Workspace", slug: `f193-dash-${uniqueSuffix}` })
        .select("id")
        .single();
      if (wsErr || !ws) throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      workspaceId = ws.id;

      const { error: memberErr } = await adminClient.from("workspace_members").insert({
        workspace_id: workspaceId,
        user_id: memberUserId,
        role: "owner",
        status: "active",
      });
      if (memberErr) throw new Error(`Failed to seed membership: ${memberErr.message}`);

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F193 Dashboard Project" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
      projectId = project.id;

      const { data: live, error: liveErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F193 dashboard live task",
          status: "todo",
          priority: "urgent",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (liveErr || !live) throw new Error(`Failed to seed live task: ${liveErr?.message}`);
      createdTaskIds.push(live.id);

      const { data: trashed, error: trashedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "F193 dashboard trashed task",
          status: "todo",
          priority: "urgent",
          author_id: memberUserId,
          deleted_at: new Date().toISOString(),
          deleted_by: memberUserId,
        })
        .select("id")
        .single();
      if (trashedErr || !trashed) throw new Error(`Failed to seed trashed task: ${trashedErr?.message}`);
      createdTaskIds.push(trashed.id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword({
        email: memberEmail,
        password: memberPassword,
      });
      if (signInErr) throw new Error(`Failed to sign in member: ${signInErr.message}`);
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      await adminClient.from("projects").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await adminClient.from("workspaces").delete().eq("id", workspaceId);
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("test_AS_350_dashboard_priority_counts_exclude_trashed_tasks", async () => {
      const { getPriorityCounts } = await import("@/lib/queries/dashboard");

      const { data, error } = await getPriorityCounts(memberClient, workspaceId);

      expect(error).toBeNull();
      const urgent = data?.find((row) => row.priority === "urgent");
      expect(urgent?.count).toBe(1);
    });
  },
);
