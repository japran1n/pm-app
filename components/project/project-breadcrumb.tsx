"use client";

import { useSetBreadcrumb } from "@/components/nav/breadcrumb-context";

// UX-09: registers this project's name into the header breadcrumb. The
// project detail layout (a Server Component) already loaded `project` for
// its own header/tabs — this just announces it upward instead of the
// header re-fetching the same row.
export function ProjectBreadcrumb({
  workspaceSlug,
  projectId,
  projectName,
}: {
  workspaceSlug: string;
  projectId: string;
  projectName: string;
}) {
  useSetBreadcrumb([
    { label: projectName, href: `/w/${workspaceSlug}/projects/${projectId}` },
  ]);
  return null;
}
