// Integration test for F242 (AS-460), run against the real linked
// Supabase project — mirrors the loadDotEnv/skipIf pattern established by
// tests/integration/search-tasks.test.ts and
// tests/integration/rls-project-visibility.test.ts.
//
// This mission has had repeated real privilege-escalation bugs in exactly
// this shape (F322, F323, M16's task_dependencies fix) — a caller who is
// an active workspace member, but NOT a member of a private project, must
// never see that private project's tasks or the project itself through a
// new read surface. The command palette (F242) is a new, workspace-wide
// read surface, so it needs the same explicit proof the others got.
//
// `searchPalette` (lib/actions/palette-search.ts) uses the plain
// RLS-scoped session client throughout (`createClient()`, never
// `createAdminClient()` for the actual data reads) — this test proves
// that end-to-end, not by code review alone: an outsider workspace member
// searching for a unique token that exists ONLY inside a private project
// they cannot see gets zero project results and zero task results for it.

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
  "searchPalette excludes private-project tasks/projects from an outsider workspace member (F242: AS-460)",
  () => {
    let adminClient: SupabaseClient;
    let workspaceId: string;
    let privateProjectId: string;
    let outsiderUserId: string;
    const createdTaskIds: string[] = [];
    let uniqueToken: string;

    beforeAll(async () => {
      adminClient = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      uniqueToken = `zzpx${uniqueSuffix.replace(/[^a-z0-9]/gi, "")}`;

      const outsiderEmail = `f242-palette-outsider-${uniqueSuffix}@example.com`;
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
          name: "F242 Palette Leak Workspace",
          slug: `f242-palette-leak-${uniqueSuffix}`,
        })
        .select("id")
        .single();
      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message}`);
      }
      workspaceId = ws.id;

      // Outsider IS an active workspace member (so the palette itself is
      // usable), but is NOT a member of the private project below.
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

      const { data: privateProject, error: privateProjectErr } = await adminClient
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: `F242 Private Project ${uniqueToken}`,
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
          title: `F242 private task ${uniqueToken}`,
          author_id: outsiderUserId,
        })
        .select("id")
        .single();
      if (privateTaskErr || !privateTask) {
        throw new Error(`Failed to seed private task: ${privateTaskErr?.message}`);
      }
      createdTaskIds.push(privateTask.id);

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
      if (workspaceId) {
        await adminClient.from("workspace_members").delete().eq("workspace_id", workspaceId);
        await adminClient.from("workspaces").delete().eq("id", workspaceId);
      }
      if (outsiderUserId) await adminClient.auth.admin.deleteUser(outsiderUserId);
    });

    it("AS-460: searching a token that exists only inside a private project the caller cannot see returns no project and no task results", async () => {
      const { searchPalette } = await import("@/lib/actions/palette-search");

      const results = await searchPalette(workspaceId, uniqueToken);

      expect(results.tasks.some((t) => t.projectId === privateProjectId)).toBe(false);
      expect(results.tasks.length).toBe(0);
      expect(results.projects.some((p) => p.id === privateProjectId)).toBe(false);
      expect(results.projects.length).toBe(0);
    });
  },
);
