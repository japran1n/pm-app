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
    label: "the list/dashboard filter's assignee picker",
    path: "components/task/list-filters.tsx",
  },
  {
    label: "the new-task dialog's assignee picker",
    path: "components/task/new-task-dialog.tsx",
  },
  {
    label: "the list view / dashboard table's Assignee column",
    path: "components/task/task-list-table.tsx",
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

  it("the dashboard table (components/dashboard/dashboard-task-table.tsx) composes <TaskListTable> — the shared component already proven above to render UserAvatar — rather than a second, parallel table implementation", () => {
    const source = readSource(
      "components/dashboard/dashboard-task-table.tsx",
    );
    expect(source).toMatch(/<TaskListTable\b/);
    expect(source).not.toMatch(/<UserAvatar\b/);
  });
});
