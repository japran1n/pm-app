// Barrel for the Architecture board's server actions.
//
// The implementations used to live in this single file (1,921 lines). They
// were split into cohesive modules under `lib/actions/architecture/` as a
// PURE MOVE — no behaviour, comment, or call site changed. This file stays
// put so every module that `import { ... } from "@/lib/actions/architecture"`
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
  renamePage,
  deletePage,
  reorderPages,
  importPages,
} from "./architecture/pages";
export type { CreatePageResult } from "./architecture/pages";

export {
  createSection,
  deleteSection,
  renameSection,
  reorderSections,
  moveSectionToPage,
} from "./architecture/sections";

export {
  createComponentFromSection,
  createComponent,
  linkComponentToSection,
  renameComponent,
  unlinkComponentFromSection,
  deleteComponent,
} from "./architecture/components";
