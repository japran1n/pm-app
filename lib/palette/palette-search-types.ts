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
