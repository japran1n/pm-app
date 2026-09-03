// @vitest-environment jsdom
//
// F005b (missions/20260903-portal): <TaskTypeManager>'s own "Team UI"
// scope item — a task type carrying a `system_key` shows a small badge
// explaining that the portal's Pages view uses it, and renaming stays
// allowed (the badge is informational only, never a lock on the name
// field).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}));

vi.mock("@/lib/actions/task-types", () => ({
  createTaskType: vi.fn(),
  updateTaskType: vi.fn(async () => ({ ok: true })),
  deleteTaskType: vi.fn(),
  reorderTaskType: vi.fn(),
}));

import { TaskTypeManager } from "@/components/workspace/task-type-manager";
import { TooltipProvider } from "@/components/ui/tooltip";
import { updateTaskType } from "@/lib/actions/task-types";
import type { TaskType } from "@/lib/queries/task-types";

afterEach(() => {
  cleanup();
});

const PAGE_TYPE: TaskType = {
  id: "type-1",
  name: "Page",
  color: "#3670e1",
  position: 0,
  systemKey: "page",
};

const PLAIN_TYPE: TaskType = {
  id: "type-2",
  name: "Design",
  color: "#b57a00",
  position: 1,
  systemKey: null,
};

describe("TaskTypeManager system_key badge (F005b)", () => {
  it("test_F005b_primary_a_system_keyed_type_shows_a_portal_badge_explaining_its_role", () => {
    render(
      <TooltipProvider delay={0}>
        <TaskTypeManager
          workspaceId="ws-1"
          initialTaskTypes={[PAGE_TYPE]}
          canManage
        />
      </TooltipProvider>,
    );

    const badge = screen.getByText("Portal");
    expect(badge).toBeInTheDocument();

    fireEvent.focus(badge.closest("button")!);
    expect(
      screen.getByText(/The portal's Pages view lists every task of this type/),
    ).toBeInTheDocument();
  });

  it("test_F005b_a_plain_task_type_with_no_system_key_shows_no_badge", () => {
    render(
      <TooltipProvider delay={0}>
        <TaskTypeManager
          workspaceId="ws-1"
          initialTaskTypes={[PLAIN_TYPE]}
          canManage
        />
      </TooltipProvider>,
    );

    expect(screen.queryByText("Portal")).not.toBeInTheDocument();
  });

  it("test_F005b_renaming_a_system_keyed_type_stays_allowed", async () => {
    render(
      <TooltipProvider delay={0}>
        <TaskTypeManager
          workspaceId="ws-1"
          initialTaskTypes={[PAGE_TYPE]}
          canManage
        />
      </TooltipProvider>,
    );

    const input = screen.getByLabelText("Task type name") as HTMLInputElement;
    expect(input).not.toBeDisabled();

    fireEvent.change(input, { target: { value: "Sida" } });
    fireEvent.blur(input);

    await vi.waitFor(() => {
      expect(updateTaskType).toHaveBeenCalledWith({ taskTypeId: "type-1", name: "Sida" });
    });
  });
});
