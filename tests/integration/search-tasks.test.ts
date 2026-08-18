// Integration test for F069 (AS-116, AS-119, AS-120), run against the real
// linked Supabase project — mirrors the loadDotEnv/skipIf pattern
// established by tests/integration/list-view-render.test.ts.
//
// Exercises `searchWorkspaceTasks` (lib/queries/search.ts), the data layer
// behind the Search page
// (app/(workspace)/w/[workspaceSlug]/search/page.tsx), seeded with a
// matching task, a non-matching task, a soft-deleted task, and a task in a
// different workspace, to prove:
//   AS-116: a workspace member's query returns the matching task(s).
//   AS-119: a query matching nothing returns an empty array (the page
//     renders this as an explicit "no results" state, never throwing).
//   AS-120: each result carries the `projectId` needed to link to that
//     task's project board (`/w/[slug]/projects/[projectId]/board`).
// An empty query (AS-116's page-level "neutral prompt" state) is also
// covered: `searchWorkspaceTasks` must resolve to `[]` without ever
// touching the network, i.e. without throwing.

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

let memberClient: SupabaseClient | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => memberClient,
}));

describe.skipIf(!haveAdminCreds)(
  "searchWorkspaceTasks (F069: AS-116, AS-119, AS-120)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let otherWorkspaceId: string;
    let projectId: string;
    let memberUserId: string;
    const createdTaskIds: string[] = [];

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const memberEmail = `f069-search-member-${uniqueSuffix}@example.com`;
      const memberPassword = "Test-password-1!";
      const { data: memberAuth, error: memberAuthErr } =
        await adminClient.auth.admin.createUser({
          email: memberEmail,
          password: memberPassword,
          email_confirm: true,
        });
      if (memberAuthErr || !memberAuth.user) {
        throw new Error(
          `Failed to create test user: ${memberAuthErr?.message}`,
        );
      }
      memberUserId = memberAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F069 Search Workspace",
          slug: `f069-search-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      // A second, unrelated workspace the member does NOT belong to — its
      // task must never appear in this member's search results (AS-118's
      // workspace scoping boundary, exercised alongside AS-116/119/120).
      const { data: otherWs, error: otherWsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F069 Other Workspace",
          slug: `f069-other-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (otherWsErr || !otherWs) {
        throw new Error(
          `Failed to create other workspace: ${otherWsErr?.message}`,
        );
      }
      otherWorkspaceId = otherWs.id;

      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserId,
          role: "owner",
          status: "active",
        });
      if (memberErr) {
        throw new Error(`Failed to seed membership: ${memberErr.message}`);
      }

      const { data: project, error: projectErr } = await adminClient
        .from("projects")
        .insert({ workspace_id: workspaceId, name: "F069 Search Project" })
        .select("id")
        .single();
      if (projectErr || !project) {
        throw new Error(`Failed to seed project: ${projectErr?.message}`);
      }
      projectId = project.id;

      const { data: otherProject, error: otherProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: otherWorkspaceId,
          name: "F069 Other Workspace Project",
        })
        .select("id")
        .single();
      if (otherProjectErr || !otherProject) {
        throw new Error(
          `Failed to seed other-workspace project: ${otherProjectErr?.message}`,
        );
      }

      const uniqueTerm = `zzsearchable${uniqueSuffix.replace(/[^a-z0-9]/gi, "")}`;

      const { data: matchTask, error: matchErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `Fix the ${uniqueTerm} bug`,
          status: "todo",
          priority: "high",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (matchErr || !matchTask) {
        throw new Error(`Failed to seed matching task: ${matchErr?.message}`);
      }
      createdTaskIds.push(matchTask.id);

      const { data: nonMatchTask, error: nonMatchErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: "Unrelated task title",
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (nonMatchErr || !nonMatchTask) {
        throw new Error(
          `Failed to seed non-matching task: ${nonMatchErr?.message}`,
        );
      }
      createdTaskIds.push(nonMatchTask.id);

      // Soft-deleted task whose title matches the search term — must NOT
      // appear (AS-121, exercised as part of AS-116's "matching" claim).
      const { data: deletedTask, error: deletedErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: projectId,
          title: `Deleted ${uniqueTerm} task`,
          status: "todo",
          author_id: memberUserId,
          deleted_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (deletedErr || !deletedTask) {
        throw new Error(
          `Failed to seed deleted task: ${deletedErr?.message}`,
        );
      }
      createdTaskIds.push(deletedTask.id);

      // A task in the OTHER workspace whose title also matches the search
      // term — must never appear in this member's results (AS-118/AS-122).
      const { data: leakTask, error: leakErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: otherProject.id,
          title: `Other workspace ${uniqueTerm} task`,
          status: "todo",
          author_id: memberUserId,
        })
        .select("id")
        .single();
      if (leakErr || !leakTask) {
        throw new Error(`Failed to seed leak task: ${leakErr?.message}`);
      }
      createdTaskIds.push(leakTask.id);

      memberClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await memberClient.auth.signInWithPassword(
        {
          email: memberEmail,
          password: memberPassword,
        },
      );
      if (signInErr) {
        throw new Error(`Failed to sign in member: ${signInErr.message}`);
      }

      (globalThis as { __f069UniqueTerm?: string }).__f069UniqueTerm =
        uniqueTerm;
      (globalThis as { __f069MatchTaskId?: string }).__f069MatchTaskId =
        matchTask.id;
      (globalThis as { __f069ProjectId?: string }).__f069ProjectId =
        projectId;
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      await adminClient.from("projects").delete().eq("workspace_id", workspaceId);
      await adminClient
        .from("projects")
        .delete()
        .eq("workspace_id", otherWorkspaceId);
      for (const id of [workspaceId, otherWorkspaceId]) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", id);
        await adminClient.from("workspaces").delete().eq("id", id);
      }
      if (memberUserId) await adminClient.auth.admin.deleteUser(memberUserId);
    });

    it("AS-116, AS-120: a matching query returns the task with a projectId that builds a working board link", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");
      const uniqueTerm = (globalThis as { __f069UniqueTerm?: string })
        .__f069UniqueTerm!;
      const matchTaskId = (globalThis as { __f069MatchTaskId?: string })
        .__f069MatchTaskId!;

      const results = await searchWorkspaceTasks(workspaceId, uniqueTerm);

      expect(results.length).toBe(1);
      expect(results[0].id).toBe(matchTaskId);
      expect(results[0].title).toContain(uniqueTerm);
      expect(results[0].projectId).toBe(projectId);

      // AS-120: the link a page would render from this result resolves to
      // the task's own project board.
      const boardHref = `/w/some-slug/projects/${results[0].projectId}/board`;
      expect(boardHref).toBe(`/w/some-slug/projects/${projectId}/board`);
    });

    it("AS-119: a query matching no tasks resolves to an empty array, not an error", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      const results = await searchWorkspaceTasks(
        workspaceId,
        "nonexistent-term-xyzabc-12345",
      );

      expect(results).toEqual([]);
    });

    it("empty query resolves to an empty array without ever calling the database", async () => {
      const { searchWorkspaceTasks } = await import("@/lib/queries/search");

      const results = await searchWorkspaceTasks(workspaceId, "   ");

      expect(results).toEqual([]);
    });
  },
);
