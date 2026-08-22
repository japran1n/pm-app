// F193 (AS-350): systematic sweep — dedicated per-surface trash-exclusion
// test for the Search surface (see this feature's own explicit "one
// integration test per surface" instruction).
//
// searchWorkspaceTasks (lib/queries/search.ts) calls the search_tasks RPC
// (supabase/migrations/20260818050300_fts_tasks_search_fn.sql), whose WHERE
// clause already filters `deleted_at is null` — search-tasks.test.ts (F069)
// already exercises this as a side effect of AS-116, but this file gives it
// its own dedicated AS-350-named test per this feature's explicit
// per-surface instruction.

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
    "F278: missing Supabase credentials required to run this suite in CI (haveAdminCreds is false). Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "searchWorkspaceTasks trash exclusion (F193: AS-350)",
  () => {
    let adminClient: SupabaseClient;
    let projectId: string;
    let workspaceId: string;
    let memberUserId: string;
    let liveTaskId: string;
    const createdTaskIds: string[] = [];
    let uniqueTerm: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueTerm = `zzf193trash${uniqueSuffix.replace(/[^a-z0-9]/gi, "")}`;

      const memberEmail = `f193-search-member-${uniqueSuffix}@example.com`;
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
        .insert({ name: "F193 Search Workspace", slug: `f193-search-${uniqueSuffix}` })
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
        .insert({ workspace_id: workspaceId, name: "F193 Search Project" })
        .select("id")
        .single();
      if (projectErr || !project) throw new Error(`Failed to seed project: ${projectErr?.message}`);
      projectId = project.id;

      const { data: live, error: liveErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F193 live ${uniqueTerm} task`,
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (liveErr || !live) throw new Error(`Failed to seed live task: ${liveErr?.message}`);
      liveTaskId = live.id;
      createdTaskIds.push(live.id);

      const { data: trashed, error: trashedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `F193 trashed ${uniqueTerm} task`,
          status: "todo",
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

    it("test_AS_350_search_excludes_trashed_tasks", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      const results = await searchWorkspaceTasks(workspaceId, uniqueTerm);
      const ids = results.map((r) => r.id);

      expect(ids).toContain(liveTaskId);
      expect(ids.length).toBe(1);
    });
  },
);
