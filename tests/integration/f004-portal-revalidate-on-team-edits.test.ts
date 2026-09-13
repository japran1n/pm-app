// F004 (missions/20260914-portal-simplify, AS-006): "Team edits refresh
// the portal." Audit finding was that several team-side write actions
// only called `revalidatePath` on `/w/...` routes (or not at all), so a
// client viewing the portal could see stale data until an unrelated
// cache invalidation happened to touch the same path.
//
// This test drives the ACTUAL Server Actions (not their internal
// `revalidate*` helpers, which aren't exported) against a real signed-in
// session and a real DB, matching this mission's established pattern
// (tests/integration/f080-portal-settings-authz.test.ts). `next/cache`'s
// `revalidatePath` is replaced with a spy so we can assert each action
// also revalidates `/portal/${slug}/p/${projectId}` with `"layout"`, not
// just its `/w/...` settings page.
//
// Covers a representative action from each of: project-site.ts,
// deliverables.ts, portal-settings.ts, and lib/actions/tasks/edit.ts
// (client-visible task edit) plus lib/actions/time-entries.ts. The other
// files this feature touches (phases.ts, project-budgets.ts,
// project-records.ts, metrics.ts) follow the exact same
// `revalidatePortalProject(workspaceSlug, projectId)` call added inside
// their existing `revalidate*` helper (lib/actions/portal-revalidate.ts)
// — see this feature's handoff for the full file list.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

const haveCreds = Boolean(SUPABASE_URL && PUBLISHABLE_KEY && SECRET_KEY);
if (process.env.CI && !haveCreds) {
  throw new Error(
    "F004: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
  );
}

const PASSWORD = "Test-password-1!";

let currentSession: SupabaseClient | null = null;

const revalidatePathSpy = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: (path: string, type?: string) => revalidatePathSpy(path, type),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentSession,
}));

describe.skipIf(!haveCreds)(
  "F004 (AS-006): team edits also revalidate the portal, not just /w",
  () => {
    let admin: SupabaseClient;
    let ownerSession: SupabaseClient;

    let workspaceSlug: string;
    let workspaceId: string;
    let projectId: string;
    let taskId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({
        email: `f004-portal-revalidate-owner-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (ownerErr || !ownerUser.user) throw new Error(`owner: ${ownerErr?.message}`);
      createdUserIds.push(ownerUser.user.id);

      workspaceSlug = `f004-portal-revalidate-${suffix}`;
      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F004 portal revalidate test", slug: workspaceSlug })
        .select("id")
        .single();
      if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
      workspaceId = workspace.id;

      await admin.from("workspace_members").insert([
        { workspace_id: workspaceId, user_id: ownerUser.user.id, role: "owner", status: "active" },
      ]);

      const { data: project, error: projectError } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "F004 portal revalidate project",
          visibility: "workspace",
          created_by: ownerUser.user.id,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
      projectId = project.id;

      const { createTaskForUser } = await import("@/lib/tasks/create");
      const created = await createTaskForUser(ownerUser.user.id, {
        projectId,
        title: "F004 portal revalidate task",
        status: "To Do",
      });
      if (!created.ok) throw new Error(`task: ${created.error}`);
      taskId = created.data.id;

      const { error: makeVisibleError } = await admin
        .from("tasks")
        .update({ client_visible: true })
        .eq("id", taskId);
      if (makeVisibleError) throw new Error(`task client_visible: ${makeVisibleError.message}`);

      const session = createClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error: signInError } = await session.auth.signInWithPassword({
        email: ownerUser.user.email!,
        password: PASSWORD,
      });
      if (signInError) throw new Error(`sign in owner: ${signInError.message}`);
      ownerSession = session;
      currentSession = ownerSession;
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      await admin.from("tasks").delete().eq("project_id", projectId);
      await admin.from("projects").delete().eq("id", projectId);
      await admin.from("workspace_members").delete().eq("workspace_id", workspaceId);
      await admin.from("workspaces").delete().eq("id", workspaceId);
      for (const id of createdUserIds) await admin.auth.admin.deleteUser(id);
    }, 60_000);

    const expectedPortalPath = () => `/portal/${workspaceSlug}/p/${projectId}`;

    it("test_AS_006_portal_settings_edit_revalidates_portal: updateProjectLaunch revalidates the portal path", async () => {
      revalidatePathSpy.mockClear();
      const { updateProjectLaunch } = await import("@/lib/actions/portal-settings");
      const result = await updateProjectLaunch({
        projectId,
        targetLaunchDate: "2026-12-01",
        launchConfidence: "on_track",
        launchNote: null,
        warrantyUntil: null,
        warrantyTerms: null,
      });
      expect(result.ok).toBe(true);

      const calledPortalPath = revalidatePathSpy.mock.calls.some(
        ([path, type]) => path === expectedPortalPath() && type === "layout",
      );
      expect(calledPortalPath).toBe(true);
    });

    it("test_AS_006_project_site_link_revalidates_portal: createProjectLink revalidates the portal path", async () => {
      revalidatePathSpy.mockClear();
      const { createProjectLink } = await import("@/lib/actions/project-site");
      const result = await createProjectLink({
        projectId,
        kind: "live",
        label: "Live site",
        url: "https://example.com",
        clientVisible: true,
      });
      expect(result.ok).toBe(true);

      const calledPortalPath = revalidatePathSpy.mock.calls.some(
        ([path, type]) => path === expectedPortalPath() && type === "layout",
      );
      expect(calledPortalPath).toBe(true);
    });

    it("test_AS_006_deliverable_create_revalidates_portal: createDeliverable revalidates the portal path", async () => {
      revalidatePathSpy.mockClear();
      const { createDeliverable } = await import("@/lib/actions/deliverables");
      const result = await createDeliverable({
        projectId,
        title: "F004 revalidate deliverable",
        kind: "other",
        ownerName: "Owner",
      });
      expect(result.ok).toBe(true);

      const calledPortalPath = revalidatePathSpy.mock.calls.some(
        ([path, type]) => path === expectedPortalPath() && type === "layout",
      );
      expect(calledPortalPath).toBe(true);
    });

    it("test_AS_006_log_time_entry_revalidates_portal: logTimeEntry revalidates the portal path", async () => {
      revalidatePathSpy.mockClear();
      const { logTimeEntry } = await import("@/lib/actions/time-entries");
      const result = await logTimeEntry(taskId, 30, false, "2026-09-14");
      expect(result.ok).toBe(true);

      const calledPortalPath = revalidatePathSpy.mock.calls.some(
        ([path, type]) => path === expectedPortalPath() && type === "layout",
      );
      expect(calledPortalPath).toBe(true);
    });

    it("test_AS_006_client_visible_task_edit_revalidates_portal: editTask on a client-visible task revalidates the portal path", async () => {
      revalidatePathSpy.mockClear();
      const { editTask } = await import("@/lib/actions/tasks/edit");
      const result = await editTask(taskId, { title: "F004 revalidate task (edited)" });
      expect(result.ok).toBe(true);

      const calledPortalPath = revalidatePathSpy.mock.calls.some(
        ([path, type]) => path === expectedPortalPath() && type === "layout",
      );
      expect(calledPortalPath).toBe(true);
    });

    it("test_AS_006_non_client_visible_task_edit_does_not_revalidate_portal: editTask on a non-shared task does NOT touch the portal path", async () => {
      const { data: ownerRow } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .maybeSingle();

      const { createTaskForUser } = await import("@/lib/tasks/create");
      const created = await createTaskForUser(ownerRow!.user_id as string, {
        projectId,
        title: "F004 private task",
        status: "To Do",
      });
      if (!created.ok) throw new Error(`private task: ${created.error}`);
      const privateTaskId = created.data.id;
      // createTaskForUser's own default is client_visible: false, but this
      // asserts it explicitly rather than relying on that default.
      await admin.from("tasks").update({ client_visible: false }).eq("id", privateTaskId);

      revalidatePathSpy.mockClear();
      const { editTask } = await import("@/lib/actions/tasks/edit");
      const result = await editTask(privateTaskId, { title: "F004 private task (edited)" });
      expect(result.ok).toBe(true);

      const calledPortalPath = revalidatePathSpy.mock.calls.some(
        ([path]) => path === expectedPortalPath(),
      );
      expect(calledPortalPath).toBe(false);

      await admin.from("tasks").delete().eq("id", privateTaskId);
    });
  },
);
