import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

// BoardEmptyState now renders <NewTaskDialog>, which calls useRouter —
// stub it out since this test SSR-renders the component directly with no
// Next app-router context mounted (this repo's tests use
// `environment: "node"`, no jsdom).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { BoardEmptyState } from "@/components/board/board-empty-state";

// F032 (AS-041): "A project with zero tasks shows an empty state on the
// Board view with a prompt to create the first task." This test proves the
// component itself satisfies AS-041's requirements: an explicit "no tasks"
// message plus a visible, working prompt/action to create the first task.
//
// The "Create task" trigger used to render as a permanently disabled
// button (createTask didn't exist until F035) — since fixed, it now
// renders the real <NewTaskDialog> (which wraps F035's createTask), so
// this test asserts the trigger is present and enabled, not disabled.
describe("BoardEmptyState (AS-041)", () => {
  const props = { projectId: "11111111-1111-1111-1111-111111111111", assigneeOptions: [] };

  it("test_AS_041_shows_empty_state_message_and_create_task_prompt", () => {
    const html = renderToStaticMarkup(createElement(BoardEmptyState, props));

    // Explicit empty-state message.
    expect(html).toContain("No tasks yet in this project");

    // A working, enabled prompt/action to create the first task (not the
    // `disabled` HTML attribute — the button's Tailwind classes
    // legitimately contain the literal substring "disabled:" for its
    // disabled *state* styling, which isn't the same thing).
    expect(html).toContain("Create task");
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
  });

  it("test_AS_041_create_task_button_has_accessible_name", () => {
    const html = renderToStaticMarkup(createElement(BoardEmptyState, props));

    // AS-152: interactive elements have accessible names — the button's
    // own visible text ("Create task") already serves as its accessible
    // name now that it's a real, enabled trigger.
    expect(html).toContain("Create task");
    expect(html).toMatch(/<button[^>]*>/);
  });
});
