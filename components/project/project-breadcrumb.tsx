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
  // F035: named "project" slot (see breadcrumb-context.tsx's `SLOT_ORDER`)
  // so it composes with the docs editor's own "doc" slot instead of the
  // two clobbering each other on `/projects/<id>/docs/<docId>`.
  useSetBreadcrumb(
    [{ label: projectName, href: `/w/${workspaceSlug}/projects/${projectId}` }],
    "project",
  );
  return null;
}
