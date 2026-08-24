// F243 (AS-462): the command palette's "quick actions" registry — Create
// task, Create project, Toggle theme, etc. A plain (no "use client"
// directive needed — this module has no server-only import to guard
// against per F330, so a directive would add nothing) data/logic module,
// not a component, so components/command/command-palette.tsx can filter
// and render it without this file owning any JSX itself.
//
// Permission model (per this feature's Correctness points: "must respect
// per-item permission, enforced in the ACTION and not by hiding UI"):
// each action below carries an `isVisible` predicate built from
// lib/auth/permissions.ts's existing `canWrite` (the SAME predicate
// `createProject`/`createTask` already re-verify server-side — see
// lib/actions/projects.ts's and lib/actions/tasks.ts's own
// `canWrite`/viewer-is-read-only checks). Hiding "Create task"/"Create
// project" from a viewer here is a UX nicety, never the enforcement
// boundary: every action below performs its effect either (a) by
// navigating to the existing page whose own create dialog already calls
// the existing, already-permission-re-checked Server Action
// (createProject/createTask — this file adds no parallel mutation of its
// own, per this feature's "must reuse existing Server Actions rather than
// parallel ones" requirement), or (b) for the theme toggle, a pure client
// state change with no server mutation at all, so there is nothing to
// re-check server-side for that one.
//
// Keyboard shortcut hints (F244): left undefined here deliberately — F244
// owns assigning/rendering the actual shortcut chords; this registry only
// reserves the optional `shortcut` field so F244 can populate it without
// touching this file's action list shape.

import type { WorkspaceRole } from "@/lib/auth/permissions";
import { canWrite } from "@/lib/auth/permissions";

export type PaletteActionContext = {
  role: WorkspaceRole | null;
  workspaceSlug: string;
  /** The caller's current next-themes value ("light" | "dark" | "system"
   * | undefined pre-hydration), so "toggle-theme" can compute its next
   * value without owning any theme state itself. */
  theme: string | undefined;
};

const THEME_CYCLE = ["light", "dark", "system"] as const;

export type PaletteAction = {
  id: string;
  label: string;
  /** Reserved for F244 (keyboard shortcut hints); unset until that
   * feature lands. */
  shortcut?: string;
  isVisible: (ctx: PaletteActionContext) => boolean;
  run: (ctx: PaletteActionContext & { setTheme: (theme: string) => void }) => {
    /** A path to navigate to, or `null` when the action has no
     * navigation effect (e.g. the theme toggle). */
    navigateTo: string | null;
  };
};

// `role: null` (no MembershipProvider in the tree, e.g. an isolated unit
// test) is treated as permissive — same fallback convention
// components/task/new-task-dialog.tsx's own `canCreate` already uses.
function writeAllowed(ctx: PaletteActionContext): boolean {
  return ctx.role === null ? true : canWrite({ role: ctx.role });
}

export const PALETTE_ACTIONS: PaletteAction[] = [
  {
    id: "create-project",
    label: "Create project",
    isVisible: writeAllowed,
    // No dedicated "new project" route exists — the create UI is a
    // dialog mounted on the projects list page (components/new-project-
    // dialog.tsx), which is out of this feature's Files scope to modify.
    // Navigating there (rather than duplicating a second creation form
    // inline in the palette) keeps `createProject`'s existing, already
    // re-verified Server Action as the ONLY path that ever inserts a
    // project.
    run: (ctx) => ({ navigateTo: `/w/${ctx.workspaceSlug}/projects` }),
  },
  {
    id: "create-task",
    label: "Create task",
    isVisible: writeAllowed,
    // Same reasoning as "create-project": task creation is project-
    // scoped (components/task/new-task-dialog.tsx requires a
    // `projectId`), and the palette has no project context of its own
    // when invoked from an arbitrary workspace page. Routing to the
    // projects list is the narrowest in-scope way to get the caller one
    // click from an existing, already-permission-checked New Task
    // dialog, without this feature inventing a second, parallel task-
    // creation path.
    run: (ctx) => ({ navigateTo: `/w/${ctx.workspaceSlug}/projects` }),
  },
  {
    id: "toggle-theme",
    label: "Toggle theme",
    // Available to every role — reading/setting the caller's own local
    // theme preference is not a workspace write of any kind (identical in
    // spirit to components/theme-toggle.tsx, which is likewise offered to
    // every role unconditionally).
    isVisible: () => true,
    // Pure client-side state change via next-themes' own `setTheme` (the
    // SAME hook components/theme-toggle.tsx already uses) — light -> dark
    // -> system -> light. No Server Action exists for this because there
    // is nothing server-side to mutate (theme is a per-device, next-themes
    // localStorage preference, exactly like this feature's own recents
    // storage decision).
    run: (ctx) => {
      const currentIndex = THEME_CYCLE.indexOf(
        (ctx.theme as (typeof THEME_CYCLE)[number]) ?? "system",
      );
      const next = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length];
      ctx.setTheme(next);
      return { navigateTo: null };
    },
  },
];
