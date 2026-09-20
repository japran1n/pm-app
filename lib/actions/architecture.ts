// Barrel for the Architecture board's server actions.
//
// The implementations used to live in this single file. They were split
// into cohesive modules under `lib/actions/architecture/` as a PURE MOVE --
// no behaviour, comment, or call site changed. This file stays put so
// every module that `import { ... } from "@/lib/actions/architecture"`
// keeps working unchanged.
//
// No `"use server"` directive here on purpose: each leaf module under
// `lib/actions/architecture/` carries its own directive, so every action is
// still defined in a "use server" module (that is what makes it a Server
// Action). A re-export barrel must stay a plain module because it also
// re-exports TYPES, which a "use server" module's "only async functions may
// be exported" rule would otherwise have to police. (Same pattern as
// lib/actions/tasks.ts.)
export {
  createPage,
  changePageKind,
  changePageSlug,
  renamePage,
  deletePage,
  reorderPages,
  setPageClientVisibility,
  importPages,
} from "./architecture/pages";
export type {
  CreatePageResult,
  SetPageClientVisibilityResult,
} from "./architecture/pages";

export {
  createSection,
  deleteSection,
  renameSection,
  reorderSections,
  moveSectionToPage,
  setSectionClientVisibility,
  changeSectionKind,
} from "./architecture/sections";
export type { SetSectionClientVisibilityResult } from "./architecture/sections";

export { getNodeDetailsForToggle } from "./architecture/node-details";

export { setNodeMeta } from "./architecture/node-meta";

export {
  createComponentFromSection,
  createComponent,
  linkComponentToSection,
  renameComponent,
  unlinkComponentFromSection,
  deleteComponent,
  reorderComponents,
} from "./architecture/components";

export { setDisciplineEstimatesBulk } from "./architecture/estimates";
