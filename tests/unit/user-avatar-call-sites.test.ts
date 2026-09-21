// Written verification for F122 (AS-214): "Avatars appear on task cards,
// in the members list, on comments, and in assignee pickers." (The
// Draft scope additionally names the dashboard table, which shares its
// implementation with the project List view's table.)
//
// AS-214 is about static UI composition, not a runtime interaction, so
// per this feature's Definition of done ("Playwright only where the
// assertion is about live interaction") this is a source-level check
// rather than a Playwright test — the same "read the file, assert the
// component is actually wired in" pattern already established by
// tests/unit/board-task-detail-sheet-wiring.test.ts's
// `sortableTaskCardSource` regex check, rather than a new pattern. A
// screenshot walkthrough of each surface is additionally recorded as a
// written verification note in this feature's handoff, since starting a
// dev server / Playwright browser was out of scope for this worker run.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

const SURFACES: { label: string; path: string }[] = [
  { label: "task cards (board)", path: "components/task/task-card.tsx" },
  {
    label: "task detail's assignee picker",
    path: "components/task/task-detail-sheet.tsx",
  },
  { label: "comments", path: "components/task/comment-list.tsx" },
  {
    label: "members list",
    path: "app/(workspace)/w/[workspaceSlug]/settings/members/page.tsx",
  },
  {
    // Krug 2 UX audit fix: the Team directory grid was never in this
    // surface list, so a regression here (e.g. a member card rendered
    // without `avatarUrl`, falling back to initials for a member who
    // does have an uploaded photo) had no source-level coverage at all.
    label: "team directory grid",
    path: "app/(workspace)/w/[workspaceSlug]/team/page.tsx",
  },
  {
    label: "team member profile",
    path: "app/(workspace)/w/[workspaceSlug]/team/[userId]/page.tsx",
  },
  {
    label: "the list/dashboard filter's assignee picker",
    path: "components/task/list-filters.tsx",
  },
  {
    label: "the new-task dialog's assignee picker",
    path: "components/task/new-task-dialog.tsx",
  },
  {
    // F250 (AS-484): the list view's Assignee column became an inline
    // editor as part of this feature — the actual <UserAvatar> render
    // moved from task-list-table.tsx into this new per-cell component it
    // renders (same "one Client Component cell per editable field"
    // pattern as list-status-select.tsx), so this surface's real avatar
    // rendering is proven here now instead.
    label: "the list view's inline Assignee column editor",
    path: "components/task/list-assignee-cell.tsx",
  },
];

describe("test_AS_214_user_avatar_wired_into_every_named_surface", () => {
  it.each(SURFACES.map(({ label, path }) => [label, path] as const))(
    "%s (%s) imports and renders <UserAvatar>",
    (_label, path) => {
      const source = readSource(path);
      expect(source).toMatch(
        /import\s*\{[^}]*\bUserAvatar\b[^}]*\}\s*from\s*["']@\/components\/user-avatar["']/,
      );
      expect(source).toMatch(/<UserAvatar\b/);
    },
  );
});
