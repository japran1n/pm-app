// Shared result shapes for the Architecture board's server actions
// (lib/actions/architecture/{pages,sections,components}.ts). These are
// the exact inline `{ success: boolean; error?: string; ... }` unions the
// original single-file lib/actions/architecture.ts repeated per action,
// named once here so the split modules share one definition.
//
// Plain module on purpose (no "use server"): it exports only types, and a
// "use server" module may export only async functions.

export type MutationResult = { success: boolean; error?: string };

export type MutationWithIdResult = {
  success: boolean;
  error?: string;
  id?: string;
};

export type MutationWithComponentIdResult = {
  success: boolean;
  error?: string;
  componentId?: string;
};
