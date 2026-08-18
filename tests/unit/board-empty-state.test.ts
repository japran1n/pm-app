import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import { BoardEmptyState } from "@/components/board/board-empty-state";

// F032 (AS-041): "A project with zero tasks shows an empty state on the
// Board view with a prompt to create the first task." Since tasks don't
// exist until F035+, every project currently has zero tasks, so the board
// page (app/(workspace)/w/[workspaceSlug]/projects/[projectId]/board/page.tsx)
// always renders this component. This test proves the component itself
// satisfies AS-041's requirements: an explicit "no tasks" message plus a
// visible prompt/action to create the first task.
describe("BoardEmptyState (AS-041)", () => {
  it("test_AS_041_shows_empty_state_message_and_create_task_prompt", () => {
    const html = renderToStaticMarkup(createElement(BoardEmptyState));

    // Explicit empty-state message.
    expect(html).toContain("No tasks yet in this project");

    // A prompt/action to create the first task — currently disabled since
    // createTask doesn't exist until F035, but visibly present so a user
    // understands what's coming next rather than seeing a dead end.
    expect(html).toContain("Create task");
    expect(html).toMatch(/disabled/);
  });

  it("test_AS_041_create_task_button_has_accessible_name", () => {
    const html = renderToStaticMarkup(createElement(BoardEmptyState));

    // AS-152: interactive elements have accessible names.
    expect(html).toContain('aria-label="Create task (coming soon)"');
  });
});
