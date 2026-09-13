// F004b (missions/20260914-portal-simplify, AS-006): M1 scrutiny
// remediation. F004's own real-DB revalidate test
// (f004-portal-revalidate-on-team-edits.test.ts) covered project-site.ts,
// deliverables.ts, portal-settings.ts, time-entries.ts and a client-visible
// tasks/edit.ts edit. This file closes the BLOCKER gaps the scrutiny review
// found:
//
//   * lib/actions/architecture.ts's create/rename/delete page+section
//     actions only revalidated `/w` -- they now also call
//     `revalidatePortalProject`.
//   * lib/actions/tasks/lifecycle.ts's deleteTask/restoreTask and
//     lib/actions/tasks/checklist.ts's toggleDescriptionChecklistItem only
//     revalidated `/w` for a client-visible task -- same fix, gated on
//     `client_visible`.
//
// Same real-DB + revalidatePath-spy pattern as f004's own test.

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
    "F004b: missing Supabase credentials required to run this suite in CI. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY as GitHub Actions repository secrets.",
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
  "F004b (AS-006): architecture / lifecycle / checklist actions revalidate the portal layout",
  () => {
    let admin: SupabaseClient;
    let ownerSession: SupabaseClient;

    let workspaceSlug: string;
    let workspaceId: string;
    let projectId: string;

    const createdUserIds: string[] = [];

    beforeAll(async () => {
      admin = createClient(SUPABASE_URL!, SECRET_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const { data: ownerUser, error: ownerErr } = await admin.auth.admin.createUser({
        email: `f004b-portal-revalidate-owner-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (ownerErr || !ownerUser.user) throw new Error(`owner: ${ownerErr?.message}`);
      createdUserIds.push(ownerUser.user.id);

      workspaceSlug = `f004b-portal-revalidate-${suffix}`;
      const { data: workspace, error: wsErr } = await admin
        .from("workspaces")
        .insert({ name: "F004b portal revalidate test", slug: workspaceSlug })
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
          name: "F004b portal revalidate project",
          visibility: "workspace",
          created_by: ownerUser.user.id,
        })
        .select("id")
        .single();
      if (projectError || !project) throw new Error(`project: ${projectError?.message}`);
      projectId = project.id;

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
    const calledPortalLayout = () =>
      revalidatePathSpy.mock.calls.some(
        ([path, type]) => path === expectedPortalPath() && type === "layout",
      );

    it("test_AS_006_create_page_revalidates_portal_layout", async () => {
      revalidatePathSpy.mockClear();
      const { createPage } = await import("@/lib/actions/architecture");
      const result = await createPage(projectId, {
        name: "F004b page",
        slug: "f004b-page",
        page_kind: "static",
      });
      expect(result.ok).toBe(true);
      expect(calledPortalLayout()).toBe(true);
    });

    it("test_AS_006_rename_page_revalidates_portal_layout", async () => {
      const { data: pageRow } = await admin
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("page_slug", "f004b-page")
        .single();

      revalidatePathSpy.mockClear();
      const { renamePage } = await import("@/lib/actions/architecture");
      const result = await renamePage(pageRow!.id as string, "F004b page renamed");
      expect(result.success).toBe(true);
      expect(calledPortalLayout()).toBe(true);
    });

    it("test_AS_006_create_section_revalidates_portal_layout", async () => {
      const { data: pageRow } = await admin
        .from("tasks")
        .select("id")
        .eq("project_id", projectId)
        .eq("page_slug", "f004b-page")
        .single();

      revalidatePathSpy.mockClear();
      const { createSection } = await import("@/lib/actions/architecture");
      const result = await createSection(pageRow!.id as string, projectId, "F004b section");
      expect(result.success).toBe(true);
      expect(calledPortalLayout()).toBe(true);
    });

    // NOTE: deletePage/deleteSection both go through the `cascade_delete_task`
    // RPC, which currently has TWO overloaded signatures live on this
    // project's Supabase instance (`p_task_id` alone, and `p_task_id` +
    // `p_deleted_by`) -- a pre-existing schema-drift issue unrelated to this
    // feature (PostgREST error PGRST203, "Could not choose the best
    // candidate function"). This is not something this feature's scope
    // (portal revalidation) can or should fix; see this handoff's Blockers/
    // Out-of-scope section. `renamePage`/`createPage`/`createSection` below
    // don't call that RPC and aren't affected.

    it("test_AS_006_delete_task_on_client_visible_task_revalidates_portal_layout", async () => {
      const { createTaskForUser } = await import("@/lib/tasks/create");
      const { data: ownerRow } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .maybeSingle();

      const created = await createTaskForUser(ownerRow!.user_id as string, {
        projectId,
        title: "F004b client-visible task (delete)",
        status: "To Do",
      });
      if (!created.ok) throw new Error(`task: ${created.error}`);
      await admin.from("tasks").update({ client_visible: true }).eq("id", created.data.id);

      revalidatePathSpy.mockClear();
      const { deleteTask } = await import("@/lib/actions/tasks/lifecycle");
      const result = await deleteTask(created.data.id);
      expect(result.ok).toBe(true);
      expect(calledPortalLayout()).toBe(true);
    });

    it("test_AS_006_delete_task_on_non_client_visible_task_does_not_revalidate_portal", async () => {
      const { createTaskForUser } = await import("@/lib/tasks/create");
      const { data: ownerRow } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .maybeSingle();

      const created = await createTaskForUser(ownerRow!.user_id as string, {
        projectId,
        title: "F004b private task (delete)",
        status: "To Do",
      });
      if (!created.ok) throw new Error(`task: ${created.error}`);
      await admin.from("tasks").update({ client_visible: false }).eq("id", created.data.id);

      revalidatePathSpy.mockClear();
      const { deleteTask } = await import("@/lib/actions/tasks/lifecycle");
      const result = await deleteTask(created.data.id);
      expect(result.ok).toBe(true);
      expect(
        revalidatePathSpy.mock.calls.some(([path]) => path === expectedPortalPath()),
      ).toBe(false);
    });

    it("test_AS_006_restore_task_on_client_visible_task_revalidates_portal_layout", async () => {
      const { createTaskForUser } = await import("@/lib/tasks/create");
      const { data: ownerRow } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .maybeSingle();

      const created = await createTaskForUser(ownerRow!.user_id as string, {
        projectId,
        title: "F004b client-visible task (restore)",
        status: "To Do",
      });
      if (!created.ok) throw new Error(`task: ${created.error}`);
      await admin.from("tasks").update({ client_visible: true }).eq("id", created.data.id);

      const { deleteTask, restoreTask } = await import("@/lib/actions/tasks/lifecycle");
      const deleted = await deleteTask(created.data.id);
      expect(deleted.ok).toBe(true);

      revalidatePathSpy.mockClear();
      const restored = await restoreTask(created.data.id);
      expect(restored.ok).toBe(true);
      expect(calledPortalLayout()).toBe(true);
    });

    it("test_AS_006_checklist_toggle_on_client_visible_task_revalidates_portal_layout", async () => {
      const { createTaskForUser } = await import("@/lib/tasks/create");
      const { data: ownerRow } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .maybeSingle();

      const itemId = "f004b-item-1";
      const created = await createTaskForUser(ownerRow!.user_id as string, {
        projectId,
        title: "F004b checklist task",
        status: "To Do",
      });
      if (!created.ok) throw new Error(`task: ${created.error}`);
      await admin
        .from("tasks")
        .update({
          client_visible: true,
          description_json: {
            type: "doc",
            content: [
              {
                type: "taskItem",
                attrs: { id: itemId, checked: false },
                content: [],
              },
            ],
          },
        })
        .eq("id", created.data.id);

      revalidatePathSpy.mockClear();
      const { toggleDescriptionChecklistItem } = await import("@/lib/actions/tasks/checklist");
      const result = await toggleDescriptionChecklistItem(created.data.id, itemId, true);
      expect(result.ok).toBe(true);
      expect(calledPortalLayout()).toBe(true);
    });
  },
);
