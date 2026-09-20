"use client";

// Standalone Sitemap tool, Phase 2: adapts lib/actions/sitemaps.ts's
// Phase 1/2 write actions to the exact `ArchitectureActions` shape
// (lib/architecture/actions-context.tsx) the shared board UI
// (ArchitectureViewToggle -> ArchitectureBoard/CanvasBoard and every leaf
// under components/architecture/) already calls unconditionally. The
// board UI never imports lib/actions/sitemaps.ts directly -- this is the
// ONE file that bridges the two, mirroring the existing
// `projectBackedActions` object in architecture-view-toggle.tsx.
//
// `estimates`, `nodeMeta`, and `clientVisibility` are project-only
// concepts (per this feature's Clarified implementation) and are
// deliberately omitted -- the Phase 0 guarantee means the corresponding
// UI affordances simply do not render for a sitemap-backed board.
import type { ArchitectureActions } from "@/lib/architecture/actions-context";
import type { MutationResult, MutationWithIdResult } from "@/lib/actions/architecture/shared";
import type { CreatePageInput } from "@/lib/validation/architecture";
import {
  createSitemapSection,
  deleteSitemapSection,
  renameSitemapSection,
  reorderSitemapSectionsFlat,
  moveSitemapSectionToPage,
  changeSectionKindSitemap,
  createSitemapPage,
  changeSitemapPageKind,
  reslugSitemapPage,
  renameSitemapPage,
  deleteSitemapPage,
  reorderSitemapPagesFlat,
  importSitemapPages,
  createSitemapComponentFromSection,
  createSitemapComponent,
  linkSitemapComponentToSection,
  unlinkSitemapComponentFromSection,
  renameSitemapComponent,
  deleteSitemapComponent,
  reorderSitemapComponents,
} from "@/lib/actions/sitemaps";

async function toId(result: { ok: true; data: { id: string } } | { ok: false; error: string }): Promise<MutationWithIdResult> {
  if (!result.ok) return { success: false, error: result.error };
  return { success: true, id: result.data.id };
}

async function toResult(result: { ok: true; data: unknown } | { ok: false; error: string }): Promise<MutationResult> {
  if (!result.ok) return { success: false, error: result.error };
  return { success: true };
}

export function buildSitemapBoardActions(sitemapId: string): ArchitectureActions {
  return {
    createSection: async (pageTaskId: string, _projectId: string, title: string) =>
      toId(await createSitemapSection({ pageId: pageTaskId, title, kind: "static" })),
    deleteSection: async (taskId: string) => toResult(await deleteSitemapSection(taskId)),
    renameSection: async (taskId: string, title: string) =>
      toResult(await renameSitemapSection(taskId, title)),
    reorderSections: async (updates: { id: string; position: number }[]) =>
      reorderSitemapSectionsFlat(updates),
    moveSectionToPage: async (sectionTaskId: string, newPageTaskId: string, position: number) =>
      moveSitemapSectionToPage(sectionTaskId, newPageTaskId, position),
    changeSectionKind: async (taskId: string, kind: string) =>
      changeSectionKindSitemap(taskId, kind),
    createPage: async (_projectId: string, data: CreatePageInput) => {
      const result = await createSitemapPage({
        sitemapId,
        title: data.name,
        slug: data.slug,
        kind: data.page_kind ?? "static",
      });
      if (!result.ok) return result;
      return {
        ok: true as const,
        data: {
          id: result.data.id,
          projectId: sitemapId,
          title: data.name,
          pageSlug: data.slug,
          pageKind: data.page_kind ?? "static",
          position: 0,
        },
      };
    },
    changePageKind: async (taskId: string, kind: string) => changeSitemapPageKind(taskId, kind),
    changePageSlug: async (taskId: string, newSlug: string) =>
      toResult(await reslugSitemapPage(taskId, newSlug)),
    renamePage: async (taskId: string, name: string) =>
      toResult(await renameSitemapPage(taskId, name)),
    deletePage: async (taskId: string) => toResult(await deleteSitemapPage(taskId)),
    reorderPages: async (updates: { id: string; position: number }[]) =>
      reorderSitemapPagesFlat(updates),
    importPages: async (_projectId: string, pages: { path: string; title: string; kind?: string }[]) =>
      importSitemapPages(sitemapId, pages),
    readOnly: false,
    componentLinks: {
      createComponent: async (_projectId: string, name: string) =>
        toId(await createSitemapComponent({ sitemapId, name })),
      createComponentFromSection: async (sectionTaskId: string, _projectId: string) => {
        const result = await createSitemapComponentFromSection(sectionTaskId, sitemapId);
        return result;
      },
      linkComponentToSection: (sectionTaskId: string, componentId: string) =>
        linkSitemapComponentToSection(sectionTaskId, componentId),
      unlinkComponentFromSection: (sectionTaskId: string) =>
        unlinkSitemapComponentFromSection(sectionTaskId),
      renameComponent: async (componentId: string, name: string) =>
        toResult(await renameSitemapComponent(componentId, name)),
      deleteComponent: async (componentId: string) =>
        toResult(await deleteSitemapComponent(componentId)),
      reorderComponents: async (_projectId: string, componentIds: string[]) =>
        reorderSitemapComponents(sitemapId, componentIds),
    },
  };
}
