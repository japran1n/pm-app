"use client";

// Shared project-backed ArchitectureActions instance — the same object that
// ArchitectureViewToggle used to define as a module-local constant.
// Extracted here so ArchitectureBoardEmptyState can supply
// ArchitectureActionsProvider without duplicating the wiring, and without
// CreatePageDialog needing to import server actions directly.
//
// This is a Client Module (the "use client" directive above) because
// ArchitectureActions types reference the server action signatures, and the
// value is consumed exclusively by Client Components.

import * as architectureActions from "@/lib/actions/architecture";
import type { ArchitectureActions } from "@/lib/architecture/actions-context";

export const projectBackedActions: ArchitectureActions = {
  createSection: (...args) => architectureActions.createSection(...args),
  deleteSection: (...args) => architectureActions.deleteSection(...args),
  renameSection: (...args) => architectureActions.renameSection(...args),
  reorderSections: (...args) => architectureActions.reorderSections(...args),
  moveSectionToPage: (...args) => architectureActions.moveSectionToPage(...args),
  changeSectionKind: (...args) => architectureActions.changeSectionKind(...args),
  createPage: (...args) => architectureActions.createPage(...args),
  changePageKind: (...args) => architectureActions.changePageKind(...args),
  changePageSlug: (...args) => architectureActions.changePageSlug(...args),
  renamePage: (...args) => architectureActions.renamePage(...args),
  deletePage: (...args) => architectureActions.deletePage(...args),
  reorderPages: (...args) => architectureActions.reorderPages(...args),
  importPages: (...args) => architectureActions.importPages(...args),
  readOnly: false,
  estimates: {
    setDisciplineEstimatesBulk: (...args) =>
      architectureActions.setDisciplineEstimatesBulk(...args),
    getNodeDetailsForToggle: (...args) =>
      architectureActions.getNodeDetailsForToggle(...args),
  },
  nodeMeta: {
    setNodeMeta: (...args) => architectureActions.setNodeMeta(...args),
  },
  clientVisibility: {
    setPageClientVisibility: (...args) =>
      architectureActions.setPageClientVisibility(...args),
    setSectionClientVisibility: (...args) =>
      architectureActions.setSectionClientVisibility(...args),
  },
  componentLinks: {
    createComponent: (...args) => architectureActions.createComponent(...args),
    createComponentFromSection: (...args) =>
      architectureActions.createComponentFromSection(...args),
    linkComponentToSection: (...args) =>
      architectureActions.linkComponentToSection(...args),
    unlinkComponentFromSection: (...args) =>
      architectureActions.unlinkComponentFromSection(...args),
    renameComponent: (...args) => architectureActions.renameComponent(...args),
    deleteComponent: (...args) => architectureActions.deleteComponent(...args),
    reorderComponents: (...args) =>
      architectureActions.reorderComponents(...args),
  },
};
