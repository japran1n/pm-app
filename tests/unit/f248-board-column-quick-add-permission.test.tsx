// @vitest-environment jsdom
//
// F248: negative-assertion coverage for the quick-add control's access
// control ("Hidden entirely for users without create rights" — this
// feature's draft scope, and this feature's Clarified implementation's
// Auth/access-control answer). Renders the real <BoardColumn> directly
// (components/board/board-column.tsx) with `canCreateTask` both true and
// false, proving the control only ever renders when the caller passes a
// real create permission — the server (createTaskForUser,
// lib/actions/tasks.ts) still independently re-checks `canWrite` even if
// this were somehow bypassed (see lib/actions/tasks.ts's own doc comment
// above that check; not re-proven here, that's this feature's Server
// Action layer, covered by tests/integration/create-task.test.ts).

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { BoardColumn } from "@/components/board/board-column";

afterEach(cleanup);

describe("F248 quick-add access control", () => {
  it("test_AS_479_quick_add_hidden_for_viewer_without_create_rights", () => {
    render(
      createElement(BoardColumn, {
        status: "todo",
        tasks: [],
        timezone: "UTC",
        projectId: "proj-1",
        canCreateTask: false,
      }),
    );

    expect(screen.queryByRole("button", { name: /add task/i })).not.toBeInTheDocument();
  });

  it("test_AS_479_quick_add_shown_for_member_with_create_rights", () => {
    render(
      createElement(BoardColumn, {
        status: "todo",
        tasks: [],
        timezone: "UTC",
        projectId: "proj-1",
        canCreateTask: true,
      }),
    );

    expect(screen.getByRole("button", { name: /add task/i })).toBeInTheDocument();
  });

  it("test_AS_479_quick_add_hidden_when_projectId_missing_even_if_permitted", () => {
    // Defense in depth: a not-yet-updated caller that omits `projectId`
    // (no way to call createTask) never renders the control even if
    // `canCreateTask` were somehow true, rather than rendering a control
    // that would crash/no-op on submit.
    render(
      createElement(BoardColumn, {
        status: "todo",
        tasks: [],
        timezone: "UTC",
        canCreateTask: true,
      }),
    );

    expect(screen.queryByRole("button", { name: /add task/i })).not.toBeInTheDocument();
  });

  it("test_AS_479_quick_add_hidden_by_default_when_omitted", () => {
    // Every existing (not-yet-updated) caller/test that renders
    // <BoardColumn> without the new props keeps the exact pre-F248
    // behaviour — no quick-add control at all.
    render(
      createElement(BoardColumn, {
        status: "todo",
        tasks: [],
        timezone: "UTC",
      }),
    );

    expect(screen.queryByRole("button", { name: /add task/i })).not.toBeInTheDocument();
  });
});
