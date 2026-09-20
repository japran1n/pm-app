"use client";

// Client wrapper for the public share route. The Server Component
// (app/(share)/s/[token]/page.tsx) cannot pass plain functions to a Client
// Component, so the no-op ArchitectureActions object is constructed here,
// inside the client boundary, instead of being created on the server.

import { ArchitectureActionsProvider } from "@/lib/architecture/actions-context";
import type { ArchitectureActions } from "@/lib/architecture/actions-context";
import { ArchitectureViewToggle } from "@/components/architecture/architecture-view-toggle";
import type { BoardPage, BoardComponent } from "@/lib/queries/architecture";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const noop = async (..._args: any[]): Promise<never> => {
  throw new Error("This sitemap is read-only.");
};

const readOnlyActions: ArchitectureActions = {
  readOnly: true,
  createSection: noop,
  deleteSection: noop,
  renameSection: noop,
  reorderSections: noop,
  moveSectionToPage: noop,
  changeSectionKind: noop,
  createPage: noop,
  changePageKind: noop,
  changePageSlug: noop,
  renamePage: noop,
  deletePage: noop,
  reorderPages: noop,
  importPages: noop,
};

export function SharedSitemapView({
  pages,
  components,
  token,
  name,
}: {
  pages: BoardPage[];
  components: BoardComponent[];
  token: string;
  name: string;
}) {
  return (
    <ArchitectureActionsProvider actions={readOnlyActions}>
      <ArchitectureViewToggle
        pages={pages}
        components={components}
        projectId={token}
        projectName={name}
        actions={readOnlyActions}
      />
    </ArchitectureActionsProvider>
  );
}
