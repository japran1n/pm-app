// Project-level authorization for the Architecture board's server actions.
//
// Every write on the board goes through the service-role client, so RLS
// never runs. These helpers re-apply what RLS would: the caller must be an
// active member of the project's workspace, must be able to see the
// project (private projects, guest project scoping) and must hold a team
// write role. The project is always resolved from the target row by the
// caller, never taken from a client-supplied id alone.
//
// Plain module on purpose (no "use server"): these helpers take the admin
// client as an argument and must not be callable as Server Actions.
import type { createAdminClient } from "@/lib/supabase/admin";
import { requireActiveMembership } from "@/lib/auth/require-membership";
import {
  canEditTask,
  canTeamWrite,
  type WorkspaceRole,
} from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";
import { extractWorkspaceSlug } from "@/lib/actions/portal-revalidate";

type AdminClient = ReturnType<typeof createAdminClient>;

export type ArchitectureProjectAccess = {
  projectId: string;
  workspaceId: string;
  workspaceSlug: string | undefined;
  role: WorkspaceRole;
};

export type ArchitectureAuthzResult =
  | { ok: true; access: ArchitectureProjectAccess }
  | { ok: false; reason: "not_found" | "forbidden" };

export type ArchitectureAuthzOptions = {
  // Default true. False authorizes a read (membership + visibility only).
  write?: boolean;
  // "task" gates with `canEditTask` (the gate setTaskClientVisibility
  // uses) instead of the default `canTeamWrite`.
  writeGate?: "team" | "task";
};

// "not_found" only when the project row itself is missing; a non-member, a
// caller who cannot see the project, or one without a write role all get
// "forbidden" (same outcome withAuthz gives for these cases).
export async function authorizeArchitectureProject(
  admin: AdminClient,
  userId: string,
  projectId: string,
  options: ArchitectureAuthzOptions = {},
): Promise<ArchitectureAuthzResult> {
  const { data: projectRow, error } = await admin
    .from("projects")
    .select("id, workspace_id, visibility, workspaces(slug)")
    .eq("id", projectId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !projectRow) {
    return { ok: false, reason: "not_found" };
  }

  const membership = await requireActiveMembership(
    admin,
    projectRow.workspace_id,
    userId,
  );

  if (!membership.ok) {
    return { ok: false, reason: "forbidden" };
  }

  const visible = await isProjectVisibleToCaller(
    admin,
    {
      projectId: projectRow.id,
      visibility: (projectRow.visibility ?? "workspace") as ProjectVisibility,
    },
    userId,
    membership.role,
  );

  if (!visible) {
    return { ok: false, reason: "forbidden" };
  }

  if (options.write !== false) {
    const writeCheck = options.writeGate === "task" ? canEditTask : canTeamWrite;
    if (!writeCheck({ role: membership.role })) {
      return { ok: false, reason: "forbidden" };
    }
  }

  return {
    ok: true,
    access: {
      projectId: projectRow.id,
      workspaceId: projectRow.workspace_id,
      workspaceSlug: extractWorkspaceSlug(
        projectRow.workspaces as { slug: string } | { slug: string }[] | null,
      ),
      role: membership.role,
    },
  };
}

// Batch form: every distinct project must pass, or the whole batch fails
// with the first failure's reason.
export async function authorizeArchitectureProjects(
  admin: AdminClient,
  userId: string,
  projectIds: string[],
  options: ArchitectureAuthzOptions = {},
): Promise<
  | { ok: true; accessByProject: Map<string, ArchitectureProjectAccess> }
  | { ok: false; reason: "not_found" | "forbidden" }
> {
  const accessByProject = new Map<string, ArchitectureProjectAccess>();

  for (const projectId of new Set(projectIds)) {
    const result = await authorizeArchitectureProject(
      admin,
      userId,
      projectId,
      options,
    );
    if (!result.ok) return result;
    accessByProject.set(projectId, result.access);
  }

  return { ok: true, accessByProject };
}

type SectionCandidate = {
  project_id: string;
  page_slug?: string | null;
  parent_task_id: string | null;
};

// A section is a live task with no page_slug whose parent is a live,
// top-level page (page_slug set, no parent) in the same project. Any other
// subtask is a plain task and is refused by section-scoped actions.
export async function areArchitectureSections(
  admin: AdminClient,
  rows: SectionCandidate[],
): Promise<boolean> {
  if (rows.length === 0) return false;

  const parentIds = new Set<string>();
  for (const row of rows) {
    if (row.page_slug || !row.parent_task_id) return false;
    parentIds.add(row.parent_task_id);
  }

  const pages = await loadArchitecturePages(admin, [...parentIds]);
  if (!pages) return false;

  return rows.every(
    (row) => pages.get(row.parent_task_id as string) === row.project_id,
  );
}

// Page id -> project id for every id that is a live, top-level page.
// Returns null on a lookup error.
export async function loadArchitecturePages(
  admin: AdminClient,
  pageIds: string[],
): Promise<Map<string, string> | null> {
  if (pageIds.length === 0) return new Map();

  const { data, error } = await admin
    .from("tasks")
    .select("id, project_id, page_slug, parent_task_id")
    .in("id", pageIds)
    .is("deleted_at", null);

  if (error) return null;

  const pages = new Map<string, string>();
  for (const row of data ?? []) {
    if (row.page_slug && row.parent_task_id === null) {
      pages.set(row.id, row.project_id);
    }
  }
  return pages;
}
