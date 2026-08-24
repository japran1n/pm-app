// F242 (AS-460, AS-461, AS-466): plain (non-"use server") types module for
// the command palette's search results. `lib/actions/palette-search.ts`
// ("use server") may only export async functions (F331: a `"use server"`
// file with any non-function export makes Turbopack treat the whole
// module as having no exports, breaking every importing route) — these
// shared shapes live here instead so the client component
// (components/command/command-palette.tsx) can `import type` them without
// ever pulling a server-only module into the client bundle (F330).

export type PaletteProjectResult = {
  type: "project";
  id: string;
  name: string;
  key: string | null;
};

export type PaletteTaskResult = {
  type: "task";
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  projectKey: string | null;
  number: number;
};

export type PaletteMemberResult = {
  type: "member";
  userId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
};

export type PaletteSearchResults = {
  projects: PaletteProjectResult[];
  tasks: PaletteTaskResult[];
  members: PaletteMemberResult[];
};

export const PALETTE_RESULT_CAP_PER_GROUP = 5;

// F243 (AS-465): a raw, client-stored (localStorage — see
// lib/hooks/use-recent-items.ts's header comment for why) "the user
// looked at this project/task" pointer. Deliberately carries almost no
// data beyond the type/id needed to re-resolve it — a cached `name`/
// `title` is intentionally NOT stored here, because rendering a cached
// label for an item the caller has since lost visibility to would leak
// its existence/title even after `resolveRecentItems` (lib/actions/
// palette-search.ts) drops the row itself. Every render re-fetches the
// current, visibility-checked label from the server.
export type RecentItemPointer = {
  type: "project" | "task";
  id: string;
  visitedAt: number;
};

// F243: the server-resolved, visibility-checked shape returned by
// `resolveRecentItems` — reuses the exact same result shapes `searchPalette`
// already returns (PaletteProjectResult / PaletteTaskResult) rather than
// inventing a third "recent item" shape, so the client can render recents
// with the identical `CommandItem` rendering logic used for search results.
export type ResolvedRecentItems = {
  projects: PaletteProjectResult[];
  tasks: PaletteTaskResult[];
};

// Cap on how many pointers are kept in localStorage per workspace, and on
// how many resolved rows render per group — same small, product-reasonable
// default convention as PALETTE_RESULT_CAP_PER_GROUP above (no assertion
// mandates an exact number).
export const RECENT_ITEMS_CAP = 5;
