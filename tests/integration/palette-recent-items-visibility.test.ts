// Integration test for F243 (AS-465), run against the real linked
// Supabase project — mirrors tests/integration/palette-search-private-
// project-leak.test.ts's exact pattern (F242's own AS-460 proof).
//
// This feature's own Correctness points call out the same repeated
// privilege-escalation bug class this mission has shipped before (F322,
// F323, M16's task_dependencies fix), applied to `resolveRecentItems`
// specifically: a pointer to a project/task the caller has since lost
// visibility to (here: never had access to a private project in the
// first place) must resolve to nothing, and must not distinguish "lost
// access" from "never existed" -- there is no separate error path, no
// partial row, just an empty result, exactly like
// lib/views/resolve-view.ts's (F229) "dangling reference degrades
// gracefully" convention.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";

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

let outsiderSessionClient: SupabaseClient | null = null;

import { vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => outsiderSessionClient,
}));

describe.skipIf(!haveAdminCreds)(
  "resolveRecentItems excludes a private-project task/project pointer an outsider workspace member cannot see (F243: AS-465)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let privateProjectId: string;
    let visibleProjectId: string;
    let outsiderUserId: string;
    const createdTaskIds: string[] = [];
    let privateTaskId: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const outsiderEmail = `f243-recents-outsider-${uniqueSuffix}@example.com`;
      const password = "Test-password-1!";
      const { data: outsiderAuth, error: outsiderAuthErr } =
        await adminClient.auth.admin.createUser({
          email: outsiderEmail,
          password,
          email_confirm: true,
        });
      if (outsiderAuthErr || !outsiderAuth.user) {
        throw new Error(`Failed to create outsider user: ${outsiderAuthErr?.message}`);
      }
      outsiderUserId = outsiderAuth.user.id;

      const { data: ws, error: wsErr } = await adminClient
        .from("workspaces")
        .insert({
          name: "F243 Recents Leak Workspace",
          slug: `f243-recents-leak-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      // Outsider IS an active workspace member (recents are resolved
      // per-workspace), but is NOT a member of the private project below
      // -- simulating "visited this task while it/its project was still
      // visible, then lost access" without needing a second membership
      // mutation mid-test; the resolver only ever looks at CURRENT
      // visibility, so seeding it this way proves the same thing.
      const { error: memberErr } = await adminClient
        .from("workspace_members")
        .insert({
          workspace_id: workspaceId,
          user_id: outsiderUserId,
          role: "member",
          status: "active",
        });
      if (memberErr) {
        throw new Error(`Failed to seed outsider membership: ${memberErr.message}`);
      }

      const { data: visibleProject, error: visibleProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F243 Visible Project ${uniqueSuffix}`,
          visibility: "workspace",
        })
        .select("id")
        .single();
      if (visibleProjectErr || !visibleProject) {
        throw new Error(`Failed to seed visible project: ${visibleProjectErr?.message}`);
      }
      visibleProjectId = visibleProject.id;

      const { data: privateProject, error: privateProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F243 Private Project ${uniqueSuffix}`,
          visibility: "private",
        })
        .select("id")
        .single();
      if (privateProjectErr || !privateProject) {
        throw new Error(`Failed to seed private project: ${privateProjectErr?.message}`);
      }
      privateProjectId = privateProject.id;

      const { data: privateTask, error: privateTaskErr } = await adminClient
        .from("tasks")
        .insert({
          project_id: privateProjectId,
          title: `F243 private recent task ${uniqueSuffix}`,
          author_id: outsiderUserId,
        })
        .select("id")
        .single();
      if (privateTaskErr || !privateTask) {
        throw new Error(`Failed to seed private task: ${privateTaskErr?.message}`);
      }
      privateTaskId = privateTask.id;
      createdTaskIds.push(privateTaskId);

      outsiderSessionClient = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!);
      const { error: signInErr } = await outsiderSessionClient.auth.signInWithPassword({
        email: outsiderEmail,
        password,
      });
      if (signInErr) {
        throw new Error(`Failed to sign in outsider: ${signInErr.message}`);
      }
    });

    afterAll(async () => {
      for (const id of createdTaskIds) {
        await adminClient.from("tasks").delete().eq("id", id);
      }
      if (privateProjectId) {
        await adminClient.from("projects").delete().eq("id", privateProjectId);
      }
      if (visibleProjectId) {
        await adminClient.from("projects").delete().eq("id", visibleProjectId);
      }
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (outsiderUserId) await adminClient.auth.admin.deleteUser(outsiderUserId);
    });

    it("AS-465: a recent-item pointer naming a private project the caller cannot see resolves to nothing, not an error", async () => {
      const { resolveRecentItems } = await import("@/lib/actions/palette-search");

      const results = await resolveRecentItems(workspaceId, [
        { type: "project", id: privateProjectId, visitedAt: Date.now() },
      ]);

      expect(results.projects.some((p) => p.id === privateProjectId)).toBe(false);
      expect(results.projects.length).toBe(0);
    });

    it("AS-465: a recent-item pointer naming a task inside a private project the caller cannot see resolves to nothing", async () => {
      const { resolveRecentItems } = await import("@/lib/actions/palette-search");

      const results = await resolveRecentItems(workspaceId, [
        { type: "task", id: privateTaskId, visitedAt: Date.now() },
      ]);

      expect(results.tasks.some((t) => t.id === privateTaskId)).toBe(false);
      expect(results.tasks.length).toBe(0);
    });

    it("AS-465: a recent-item pointer naming a project the caller CAN see resolves normally, proving the resolver isn't dropping everything", async () => {
      const { resolveRecentItems } = await import("@/lib/actions/palette-search");

      const results = await resolveRecentItems(workspaceId, [
        { type: "project", id: visibleProjectId, visitedAt: Date.now() },
      ]);

      expect(results.projects.some((p) => p.id === visibleProjectId)).toBe(true);
    });

    it("AS-465: an unrelated workspace's caller (not even a member here) resolves every pointer for this workspace to nothing", async () => {
      const { resolveRecentItems } = await import("@/lib/actions/palette-search");

      // Reuse the same outsider session but pass a workspaceId they have
      // no membership row for at all -- defense-in-depth membership
      // re-check (requireActiveMembership) must reject before any query
      // runs.
      const results = await resolveRecentItems("00000000-0000-0000-0000-000000000000", [
        { type: "project", id: visibleProjectId, visitedAt: Date.now() },
      ]);

      expect(results.projects.length).toBe(0);
      expect(results.tasks.length).toBe(0);
    });
  },
);
