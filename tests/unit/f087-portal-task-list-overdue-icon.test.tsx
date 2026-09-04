// @vitest-environment jsdom
//
// F087 accessibility audit item 3: components/portal/task-list.tsx used
// to convey "overdue" by colour alone (`text-destructive` vs
// `text-muted-foreground`, nothing else different) -- unlike its internal
// equivalents (components/task/task-card.tsx, components/task/
// task-list-table.tsx), which pair the destructive-red text with a
// TriangleAlert icon and a `sr-only "Overdue:"` label so the state is
// never colour-only. Fixed by copying that exact treatment.
//
// Mocks the realtime wiring the same way tests/unit/portal-overview-live
// .test.tsx does for its sibling component, so this test only exercises
// the render output, not a live channel.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => ({
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
    realtime: { setAuth: vi.fn(() => Promise.resolve()) },
  })),
}));

vi.mock("@/lib/realtime/subscribe-when-authenticated", () => ({
  subscribeWhenAuthenticated: vi.fn(() => () => {}),
}));

import { PortalTaskList } from "@/components/portal/task-list";
import type { PortalProject, PortalTask } from "@/lib/queries/portal";

afterEach(cleanup);

function makeTask(overrides: Partial<PortalTask> = {}): PortalTask {
  return {
    id: "task-1",
    title: "Ship the release",
    status: "In progress",
    statusId: "status-1",
    dueDate: "2020-01-01",
    category: "in_progress",
    clientBucket: null,
    ...overrides,
  };
}

function makeProject(tasks: PortalTask[]): PortalProject {
  return {
    id: "project-1",
    name: "Project",
    description: null,
    startDate: null,
    endDate: null,
    targetLaunchDate: null,
    launchConfidence: null,
    launchNote: null,
    tasks,
    notStarted: 0,
    inProgress: tasks.length,
    done: 0,
    total: tasks.length,
    percentComplete: 0,
    nextDue: null,
    statuses: [
      { id: "status-1", name: "In progress", category: "in_progress", clientBucket: null },
      { id: "status-2", name: "Done", category: "done", clientBucket: null },
    ],
  } as PortalProject;
}

describe("test_portal_task_list_overdue_is_not_color_only", () => {
  it("an overdue task's due date is paired with a TriangleAlert icon and an sr-only 'Overdue:' label, not colour alone", () => {
    const overdueTask = makeTask({ id: "overdue-1", dueDate: "2020-01-01" });
    render(<PortalTaskList project={makeProject([overdueTask])} workspaceSlug="acme" />);

    const link = screen.getByRole("link", { name: /Ship the release/ });
    expect(link).toHaveTextContent("Overdue:");
    expect(link.querySelector("svg")).toBeInTheDocument();
    const srOnly = screen.getByText("Overdue:");
    expect(srOnly).toHaveClass("sr-only");
  });

  it("an on-time task's due date carries neither the icon nor the 'Overdue:' label", () => {
    const futureTask = makeTask({
      id: "future-1",
      title: "Not due yet",
      dueDate: "2999-01-01",
    });
    render(<PortalTaskList project={makeProject([futureTask])} workspaceSlug="acme" />);

    const link = screen.getByRole("link", { name: /Not due yet/ });
    expect(link.querySelector("svg")).not.toBeInTheDocument();
    // The "Overdue:" span is always in the DOM (mirrors task-card.tsx's
    // pattern) but toggles between `sr-only` (announced) and `hidden`
    // (not announced, not visible) -- on-time tasks must get `hidden`.
    const overdueLabel = screen.getByText("Overdue:");
    expect(overdueLabel).toHaveClass("hidden");
    expect(overdueLabel).not.toHaveClass("sr-only");
  });

  it("a done task past its due date is not marked overdue (delivered work is never late)", () => {
    const doneTask = makeTask({
      id: "done-1",
      title: "Already delivered",
      dueDate: "2020-01-01",
      category: "done",
      statusId: "status-2",
    });
    render(<PortalTaskList project={makeProject([doneTask])} workspaceSlug="acme" />);

    const link = screen.getByRole("link", { name: /Already delivered/ });
    expect(link.querySelector("svg")).not.toBeInTheDocument();
    const overdueLabel = screen.getByText("Overdue:");
    expect(overdueLabel).toHaveClass("hidden");
    expect(overdueLabel).not.toHaveClass("sr-only");
  });
});
