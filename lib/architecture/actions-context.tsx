"use client";

// Phase 0 of the standalone Sitemap tool: decouples the Architecture board
// UI from the project/tasks-backed server actions in
// lib/actions/architecture/*. Every leaf component under
// components/architecture/ now reads its mutation callbacks from this
// context instead of importing the actions module directly, so a future
// backend (or a read-only viewer) can supply a different implementation --
// or omit capabilities entirely -- without touching the UI.
//
// Capability groups that a non-project backend may not be able to support
// (per-node discipline estimates, free-form node metadata, client
// visibility toggles, and component/task linking) are OPTIONAL. When a
// group is absent the corresponding affordance must not render at all --
// no disabled-looking dead buttons.
//
// `readOnly: true` additionally means no create/rename/delete/reorder
// affordances of any kind, regardless of which capability groups are
// present.

import { createContext, useContext, type ReactNode } from "react";

import type {
  createSection,
  deleteSection,
  renameSection,
  reorderSections,
  moveSectionToPage,
  changeSectionKind,
  createPage,
  changePageKind,
  changePageSlug,
  renamePage,
  deletePage,
  reorderPages,
  importPages,
  setDisciplineEstimatesBulk,
  getNodeDetailsForToggle,
  setNodeMeta,
  setPageClientVisibility,
  setSectionClientVisibility,
  createComponent,
  createComponentFromSection,
  linkComponentToSection,
  unlinkComponentFromSection,
  renameComponent,
  deleteComponent,
  reorderComponents,
} from "@/lib/actions/architecture";

/** Mutations every backend that can host the board UI must provide. */
export interface ArchitectureCoreActions {
  createSection: typeof createSection;
  deleteSection: typeof deleteSection;
  renameSection: typeof renameSection;
  reorderSections: typeof reorderSections;
  moveSectionToPage: typeof moveSectionToPage;
  changeSectionKind: typeof changeSectionKind;
  createPage: typeof createPage;
  changePageKind: typeof changePageKind;
  changePageSlug: typeof changePageSlug;
  renamePage: typeof renamePage;
  deletePage: typeof deletePage;
  reorderPages: typeof reorderPages;
  importPages: typeof importPages;
}

/** Per-node discipline estimates (estimate chip + popover, estimate summary). */
export interface ArchitectureEstimateActions {
  setDisciplineEstimatesBulk: typeof setDisciplineEstimatesBulk;
  getNodeDetailsForToggle: typeof getNodeDetailsForToggle;
}

/** Free-form node metadata (brief / notes dialog on pages and sections). */
export interface ArchitectureNodeMetaActions {
  setNodeMeta: typeof setNodeMeta;
}

/** Client-visibility toggles on pages and sections. */
export interface ArchitectureClientVisibilityActions {
  setPageClientVisibility: typeof setPageClientVisibility;
  setSectionClientVisibility: typeof setSectionClientVisibility;
}

/** Linking a section to a project component (the component tray + picker). */
export interface ArchitectureComponentLinkActions {
  createComponent: typeof createComponent;
  createComponentFromSection: typeof createComponentFromSection;
  linkComponentToSection: typeof linkComponentToSection;
  unlinkComponentFromSection: typeof unlinkComponentFromSection;
  renameComponent: typeof renameComponent;
  deleteComponent: typeof deleteComponent;
  reorderComponents: typeof reorderComponents;
}

export interface ArchitectureActions extends ArchitectureCoreActions {
  /** True when the board is rendered as a read-only view: no create/rename/
   * delete/reorder affordances, no dialogs, no drag handles. Pan/zoom,
   * collapse/expand and the component-panel hover highlight still work. */
  readOnly: boolean;
  estimates?: ArchitectureEstimateActions;
  nodeMeta?: ArchitectureNodeMetaActions;
  clientVisibility?: ArchitectureClientVisibilityActions;
  componentLinks?: ArchitectureComponentLinkActions;
}

const ArchitectureActionsContext = createContext<ArchitectureActions | null>(null);

export function ArchitectureActionsProvider({
  actions,
  children,
}: {
  actions: ArchitectureActions;
  children: ReactNode;
}) {
  return (
    <ArchitectureActionsContext.Provider value={actions}>
      {children}
    </ArchitectureActionsContext.Provider>
  );
}

/** Throws if no provider is mounted -- every board leaf component requires one. */
export function useArchitectureActions(): ArchitectureActions {
  const ctx = useContext(ArchitectureActionsContext);
  if (!ctx) {
    throw new Error(
      "useArchitectureActions must be used within an ArchitectureActionsProvider",
    );
  }
  return ctx;
}
