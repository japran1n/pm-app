import type { createAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import {
  isProjectVisibleToCaller,
  type ProjectVisibility,
} from "@/lib/actions/project-visibility";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RelatedProjectRef = {
  id?: string | null;
  visibility?: string | null;
};

export function normalizeVisibility(value: string | null | undefined): ProjectVisibility {
  return value === "private" ? "private" : "workspace";
}

// Which of the given projects the caller can see, one lookup per distinct
// project. Used where a task's related tasks (dependencies) may live in
// another project of the same workspace than the task itself.
export async function visibleRelatedProjectIds(
  admin: AdminClient,
  userId: string,
  role: WorkspaceRole,
  projects: RelatedProjectRef[],
): Promise<Set<string>> {
  const byId = new Map<string, ProjectVisibility>();
  for (const project of projects) {
    if (project.id && !byId.has(project.id)) {
      byId.set(project.id, normalizeVisibility(project.visibility));
    }
  }

  const visible = new Set<string>();
  await Promise.all(
    [...byId].map(async ([projectId, visibility]) => {
      if (await isProjectVisibleToCaller(admin, { projectId, visibility }, userId, role)) {
        visible.add(projectId);
      }
    }),
  );
  return visible;
}
