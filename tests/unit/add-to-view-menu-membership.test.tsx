// @vitest-environment jsdom
//
// Follow-up (manual view membership, UI): proves <AddToViewMenu> actually
// shows a checkmark for a view the task already belongs to (fetched via
// listViewTaskIds when the dropdown opens) and that clicking a checked
// entry calls removeTaskFromView (not addTaskToView) -- i.e. genuine
// current-membership state and toggle behavior, not just "always safe to
// click" idempotent adds. See this feature's mission handoff for the
// follow-up this closes.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { AddToViewMenu } from "@/components/task/add-to-view-menu";
import { addTaskToView, listViewTaskIds, removeTaskFromView } from "@/lib/actions/view-tasks";

vi.mock("@/lib/actions/view-tasks", () => ({
  addTaskToView: vi.fn(),
  removeTaskFromView: vi.fn(),
  listViewTaskIds: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const views = [
  { id: "view-1", name: "Setup" },
  { id: "view-2", name: "Launch" },
];

describe("AddToViewMenu current-membership checkbox state", () => {
  it("test_a_view_the_task_already_belongs_to_shows_a_checkmark_once_opened", async () => {
    vi.mocked(listViewTaskIds).mockImplementation(async (viewId: string) => {
      if (viewId === "view-1") {
        return { ok: true, data: ["task-1"] };
      }
      return { ok: true, data: [] };
    });

    render(<AddToViewMenu taskId="task-1" views={views} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to view" }));

    const setupItem = await screen.findByText("Setup");
    await waitFor(() => {
      expect(setupItem.closest('[role="menuitem"]')?.querySelector("svg")).toBeTruthy();
    });

    const launchItem = screen.getByText("Launch");
    expect(launchItem.closest('[role="menuitem"]')?.querySelector("svg")).toBeFalsy();
  });

  it("test_clicking_a_view_the_task_already_belongs_to_removes_it_not_adds_it_again", async () => {
    vi.mocked(listViewTaskIds).mockImplementation(async (viewId: string) => {
      if (viewId === "view-1") {
        return { ok: true, data: ["task-1"] };
      }
      return { ok: true, data: [] };
    });
    vi.mocked(removeTaskFromView).mockResolvedValue({
      ok: true,
      data: { viewId: "view-1", taskId: "task-1" },
    });

    render(<AddToViewMenu taskId="task-1" views={views} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to view" }));
    const setupItem = await screen.findByText("Setup");

    await waitFor(() => {
      expect(setupItem.closest('[role="menuitem"]')?.querySelector("svg")).toBeTruthy();
    });

    fireEvent.click(setupItem);

    await waitFor(() => {
      expect(removeTaskFromView).toHaveBeenCalledWith({ viewId: "view-1", taskId: "task-1" });
    });
    expect(addTaskToView).not.toHaveBeenCalled();
  });

  it("test_clicking_a_view_the_task_does_not_belong_to_adds_it", async () => {
    vi.mocked(listViewTaskIds).mockResolvedValue({ ok: true, data: [] });
    vi.mocked(addTaskToView).mockResolvedValue({
      ok: true,
      data: { viewId: "view-2", taskId: "task-1" },
    });

    render(<AddToViewMenu taskId="task-1" views={views} />);

    fireEvent.click(screen.getByRole("button", { name: "Add to view" }));
    const launchItem = await screen.findByText("Launch");
    fireEvent.click(launchItem);

    await waitFor(() => {
      expect(addTaskToView).toHaveBeenCalledWith({ viewId: "view-2", taskId: "task-1" });
    });
    expect(removeTaskFromView).not.toHaveBeenCalled();
  });
});
