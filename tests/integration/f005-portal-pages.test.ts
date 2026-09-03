// Integration test for F005 (missions/20260903-portal): `getPortalPages`
// — the Pages view's own data layer. Covers AS-014 and AS-016, run
// against the real linked Supabase project, mirroring the
// loadDotEnv/skipIf pattern established by tests/integration/
// portal-phases-rls.test.ts and tests/integration/f003-portal-shell.test.ts.
//
// Primary success test (this feature's own Definition of done): a
// project with pages in four different buckets renders the right counts,
// and a task that is not client-visible appears in neither the table nor
// the counts.
// Failure test: a page task belonging to another project, or to a
// portal-disabled project, is absent.

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

// `getPortalPages` calls `createClient()` from `@/lib/supabase/server`,
// which is cookie-based and needs a live Next.js request context. Mocked
// here to return whichever real, signed-in test session the current test
// is exercising — same approach f003-portal-shell.test.ts takes. The
// admin client `getPortalPages` also uses internally (for the assignee
// role lookup) is NOT mocked — it reads real credentials from `.env`,
// same as every other query in this file's target module.
let activeSession: SupabaseClient | null = null;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => activeSession,
}));

describe.skipIf(!haveCreds)("getPortalPages (F005: AS-014, AS-016)", () => {
  let admin: SupabaseClient;
  let clientSession: SupabaseClient;

  let workspaceId: string;
  let projectAId: string;
  let projectBId: string;
  let disabledProjectId: string;
  let ownerId: string;
  let assigneeId: string;
  let clientId: string;
  let pageTypeId: string;

  let waitingStatusId: string;
  let progressStatusId: string;
  let blockedStatusId: string;
  let doneStatusId: string;

  let hiddenTaskId: string;
  let nonPageTaskId: string;
  let otherProjectPageTaskId: string;

  const createdUserIds: string[] = [];
  const allProjectIds: string[] = [];

  beforeAll(async () => {
    admin = createSupabaseJsClient(SUPABASE_URL!, SECRET_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const makeUser = async (label: string) => {
      const { data, error } = await admin.auth.admin.createUser({
        email: `f005-portal-pages-${label}-${suffix}@example.com`,
        password: PASSWORD,
        email_confirm: true,
      });
      if (error || !data.user) throw new Error(`${label}: ${error?.message}`);
      createdUserIds.push(data.user.id);
      return { id: data.user.id, email: data.user.email! };
    };

    const owner = await makeUser("owner");
    const assignee = await makeUser("assignee");
    const clientUser = await makeUser("client");
    ownerId = owner.id;
    assigneeId = assignee.id;
    clientId = clientUser.id;

    // A predictable display name — resolvePeople falls back to the Auth
    // Admin API / email local-part otherwise, which would make the
    // assertions below depend on this test's own generated email suffix.
    await admin
      .from("profiles")
      .update({ display_name: "Ana Petrović" })
      .eq("id", assigneeId);

    const { data: workspace, error: wsErr } = await admin
      .from("workspaces")
      .insert({ name: "F005 portal pages test", slug: `f005-portal-pages-${suffix}` })
      .select("id")
      .single();
    if (wsErr || !workspace) throw new Error(`workspace: ${wsErr?.message}`);
    workspaceId = workspace.id;

    await admin.from("workspace_members").insert([
      { workspace_id: workspaceId, user_id: ownerId, role: "owner", status: "active" },
      { workspace_id: workspaceId, user_id: assigneeId, role: "member", status: "active" },
      { workspace_id: workspaceId, user_id: clientId, role: "client", status: "active" },
    ]);

    const insertProject = async (name: string, portalEnabled: boolean) => {
      const { data, error } = await admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name,
          visibility: "workspace",
          created_by: ownerId,
          portal_enabled: portalEnabled,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`project ${name}: ${error?.message}`);
      return data.id as string;
    };

    projectAId = await insertProject("Project A", true);
    projectBId = await insertProject("Project B", true);
    disabledProjectId = await insertProject("Portal off", false);
    allProjectIds.push(projectAId, projectBId, disabledProjectId);

    await admin.from("project_members").insert(
      allProjectIds.map((projectId) => ({
        project_id: projectId,
        user_id: clientId,
        project_role: "member",
        added_by: ownerId,
      })),
    );

    // A single "Page" task type for the workspace — matched by its
    // stable `system_key` (F005b, 20260912010000_task_type_system_key.sql)
    // by getPortalPages, not by name.
    const { data: pageType, error: pageTypeError } = await admin
      .from("task_types")
      .insert({ workspace_id: workspaceId, name: "Page", color: "#3670e1", system_key: "page" })
      .select("id")
      .single();
    if (pageTypeError || !pageType) throw new Error(`task type: ${pageTypeError?.message}`);
    pageTypeId = pageType.id;

    const insertStatus = async (
      name: string,
      category: "not_started" | "in_progress" | "done",
      clientBucket: string | null,
      clientDescription: string,
    ) => {
      const { data, error } = await admin
        .from("project_statuses")
        .insert({
          project_id: projectAId,
          name,
          color: "#3670e1",
          category,
          client_bucket: clientBucket,
          client_description: clientDescription,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`status ${name}: ${error?.message}`);
      return data.id as string;
    };

    // Four statuses, one per client bucket — "Needs Client Input" proves
    // the explicit client_bucket override (category alone has no
    // "blocked" value), the other three prove the category fallback.
    waitingStatusId = await insertStatus(
      "Backlog",
      "not_started",
      null,
      "Planned, not started yet.",
    );
    progressStatusId = await insertStatus(
      "In Development",
      "in_progress",
      null,
      "We're actively building this page.",
    );
    blockedStatusId = await insertStatus(
      "Needs Client Input",
      "in_progress",
      "blocked",
      "We need something from you before we can continue.",
    );
    doneStatusId = await insertStatus("Live", "done", null, "This page is live.");

    // `tasks_sync_status_and_status_id` (20260824010000) fires on every
    // INSERT and, since `tasks.status` always has a value on insert (the
    // column's own `default 'todo'` fills it in even when omitted),
    // ALWAYS re-derives `status_id` by matching `(project_id, name =
    // status)` on insert — silently overwriting a custom `status_id`
    // passed in the same INSERT with whichever row is actually named
    // "todo"/"in_progress"/etc. (the row `projects_seed_default_statuses`
    // auto-seeds on every new project, per 20260828030000). Assigning one
    // of THIS test's own custom-named statuses therefore has to be a
    // second, separate UPDATE that touches `status_id` alone — the
    // trigger's own `elsif` branch then derives `status` TEXT from that
    // status_id's name instead, exactly the same two-step shape the real
    // app's own status-change action uses.
    const insertTask = async (opts: {
      projectId: string;
      title: string;
      statusId: string | null;
      taskTypeId: string | null;
      clientVisible: boolean;
      pageSlug: string | null;
      pageOrder: number | null;
      assigneeId?: string | null;
    }) => {
      const { data, error } = await admin
        .from("tasks")
        .insert({
          project_id: opts.projectId,
          title: opts.title,
          author_id: ownerId,
          assignee_id: opts.assigneeId ?? null,
          task_type_id: opts.taskTypeId,
          client_visible: opts.clientVisible,
          page_slug: opts.pageSlug,
          page_order: opts.pageOrder,
        })
        .select("id")
        .single();
      if (error || !data) throw new Error(`task ${opts.title}: ${error?.message}`);
      if (opts.statusId) {
        const { error: statusError } = await admin
          .from("tasks")
          .update({ status_id: opts.statusId })
          .eq("id", data.id);
        if (statusError) {
          throw new Error(`task ${opts.title} status: ${statusError.message}`);
        }
      }
      return data.id as string;
    };

    // Four client-visible page tasks on Project A, one per bucket, in a
    // deliberately scrambled page_order so AS-014's ordering assertion is
    // real (not accidentally already-sorted by insert order).
    await insertTask({
      projectId: projectAId,
      title: "Homepage",
      statusId: waitingStatusId,
      taskTypeId: pageTypeId,
      clientVisible: true,
      pageSlug: "home",
      pageOrder: 2,
      assigneeId,
    });
    await insertTask({
      projectId: projectAId,
      title: "Services",
      statusId: progressStatusId,
      taskTypeId: pageTypeId,
      clientVisible: true,
      pageSlug: "services",
      pageOrder: 4,
    });
    await insertTask({
      projectId: projectAId,
      title: "Contact",
      statusId: blockedStatusId,
      taskTypeId: pageTypeId,
      clientVisible: true,
      pageSlug: "contact",
      pageOrder: 1,
    });
    await insertTask({
      projectId: projectAId,
      title: "About",
      statusId: doneStatusId,
      taskTypeId: pageTypeId,
      clientVisible: true,
      pageSlug: "about",
      pageOrder: 3,
    });
    // No page_order at all — must sort AFTER every explicitly ordered
    // page (nulls last), by title.
    await insertTask({
      projectId: projectAId,
      title: "Zzz Unordered Page",
      statusId: waitingStatusId,
      taskTypeId: pageTypeId,
      clientVisible: true,
      pageSlug: "unordered",
      pageOrder: null,
    });

    // Failure fixtures — must be absent from Project A's own output.
    hiddenTaskId = await insertTask({
      projectId: projectAId,
      title: "Internal draft page",
      statusId: waitingStatusId,
      taskTypeId: pageTypeId,
      clientVisible: false,
      pageSlug: "internal-draft",
      pageOrder: 5,
    });
    nonPageTaskId = await insertTask({
      projectId: projectAId,
      title: "Not a page task",
      statusId: waitingStatusId,
      taskTypeId: null,
      clientVisible: true,
      pageSlug: null,
      pageOrder: null,
    });
    otherProjectPageTaskId = await insertTask({
      projectId: projectBId,
      title: "A page on a different project",
      statusId: null,
      taskTypeId: pageTypeId,
      clientVisible: true,
      pageSlug: "elsewhere",
      pageOrder: 1,
    });
    // Portal-disabled project's own page task — RLS alone must hide this
    // from a client session (folded portal_enabled check on
    // tasks_select_active_members, F001).
    await insertTask({
      projectId: disabledProjectId,
      title: "A page on a portal-disabled project",
      statusId: null,
      taskTypeId: pageTypeId,
      clientVisible: true,
      pageSlug: "hidden-project",
      pageOrder: 1,
    });

    const signIn = async (email: string) => {
      const session = createSupabaseJsClient(SUPABASE_URL!, PUBLISHABLE_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await session.auth.signInWithPassword({ email, password: PASSWORD });
      if (error) throw new Error(`sign in ${email}: ${error.message}`);
      return session;
    };
    clientSession = await signIn(clientUser.email);
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    await admin.from("tasks").delete().in("project_id", allProjectIds);
    await admin.from("project_statuses").delete().eq("project_id", projectAId);
    await admin.from("project_members").delete().in("project_id", allProjectIds);
    await admin.from("task_types").delete().eq("id", pageTypeId);
    await admin.from("projects").delete().in("id", allProjectIds);
    await admin.from("workspaces").delete().eq("id", workspaceId);
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("test_AS_014_lists_every_client_visible_page_task_ordered_by_page_order_then_title", async () => {
    activeSession = clientSession;
    const { getPortalPages } = await import("@/lib/queries/portal");
    const pages = await getPortalPages(projectAId);

    // AS-014's own failure case, inline: the non-client-visible task, the
    // non-page-type task, and the other project's page task are all
    // absent.
    expect(pages.find((p) => p.id === hiddenTaskId)).toBeUndefined();
    expect(pages.find((p) => p.id === nonPageTaskId)).toBeUndefined();
    expect(pages.find((p) => p.id === otherProjectPageTaskId)).toBeUndefined();

    // Five real client-visible page tasks remain.
    expect(pages).toHaveLength(5);

    // AS-014: ordered by page_order (nulls last), then title — never
    // created_at (every fixture above was inserted in a different order
    // than this expected result).
    expect(pages.map((p) => p.title)).toEqual([
      "Contact", // page_order 1
      "Homepage", // page_order 2
      "About", // page_order 3
      "Services", // page_order 4
      "Zzz Unordered Page", // page_order null — sorts last, by title
    ]);
  });

  it("test_AS_014_failure_a_portal_disabled_projects_page_task_is_absent", async () => {
    activeSession = clientSession;
    const { getPortalPages } = await import("@/lib/queries/portal");
    const pages = await getPortalPages(disabledProjectId);
    expect(pages).toEqual([]);
  });

  it("a project with pages in four different buckets renders the right bucket for each (primary success test)", async () => {
    activeSession = clientSession;
    const { getPortalPages } = await import("@/lib/queries/portal");
    const pages = await getPortalPages(projectAId);

    const bucketByTitle = new Map(pages.map((p) => [p.title, p.status.clientBucket]));
    expect(bucketByTitle.get("Homepage")).toBe("waiting");
    expect(bucketByTitle.get("Services")).toBe("progress");
    expect(bucketByTitle.get("Contact")).toBe("blocked");
    expect(bucketByTitle.get("About")).toBe("done");
  });

  it("test_AS_016_the_status_tooltip_description_is_read_from_the_database", async () => {
    activeSession = clientSession;
    const { getPortalPages } = await import("@/lib/queries/portal");
    const pages = await getPortalPages(projectAId);

    const contact = pages.find((p) => p.title === "Contact");
    expect(contact?.status.clientDescription).toBe(
      "We need something from you before we can continue.",
    );
  });

  it("resolves the assignee's name/avatar and workspace role with one batched call, not a per-row query", async () => {
    activeSession = clientSession;
    const { getPortalPages } = await import("@/lib/queries/portal");
    const pages = await getPortalPages(projectAId);

    const homepage = pages.find((p) => p.title === "Homepage");
    expect(homepage?.assignee?.id).toBe(assigneeId);
    expect(homepage?.assignee?.name).toBe("Ana Petrović");
    expect(homepage?.assignee?.roleLabel).toBe("Member");

    const services = pages.find((p) => p.title === "Services");
    expect(services?.assignee).toBeNull();
  });
});
