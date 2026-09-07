// @vitest-environment jsdom
//
// Follow-up (j/k keyboard navigation): j/ArrowDown moves the row focus
// down, k/ArrowUp moves it up, Enter opens the focused row's detail sheet,
// and the navigation must stay silent while an unrelated input elsewhere
// on the page has focus (same "isEditableTarget" convention F244's global
// shortcut listener uses).

import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/list",
  useSearchParams: () => new URLSearchParams(),
}));

// Mounting the real <TaskDetailSheet> needs the `getTaskDetail` Server
// Action to resolve; mocked here so Enter's "opens the sheet" assertion can
// check for the resulting dialog without a real network/DB round trip —
// same isolation boundary the bulk-selection suite's sibling test file
// draws around this component.
vi.mock("@/lib/actions/tasks", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getTaskDetail: vi.fn(async () => ({
      ok: true,
      data: {
        id: "t1",
        title: "Filtered task one",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        assigneeIds: [],
        dueDate: null,
        clientVisible: false,
        pendingClientApproval: false,
      },
    })),
  };
});

import { TaskListTable } from "@/components/task/task-list-table";
import type { TaskCardTask } from "@/components/task/task-card";

function makeFakeSupabaseRealtimeClient() {
  const channelObject = {
    on: vi.fn(() => channelObject),
    subscribe: vi.fn(() => channelObject),
  };
  return {
    channel: vi.fn(() => channelObject),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({ data: { session: null } })),
    },
  };
}
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => makeFakeSupabaseRealtimeClient(),
}));

afterEach(() => {
  cleanup();
});

function task(id: string, title: string): TaskCardTask {
  return {
    id,
    title,
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1,
  };
}

const TASKS: TaskCardTask[] = [
  task("t1", "Filtered task one"),
  task("t2", "Filtered task two"),
  task("t3", "Filtered task three"),
];

function renderTable(tasks: TaskCardTask[] = TASKS) {
  return render(
    createElement(TaskListTable, {
      tasks,
      assignees: new Map(),
      timezone: "UTC",
    }),
  );
}

function row(title: string) {
  return screen.getByText(title).closest("tr") as HTMLTableRowElement;
}

describe("j/k list navigation", () => {
  it("test_jk_pressing_j_focuses_the_first_row_then_moves_to_the_next", () => {
    renderTable();

    fireEvent.keyDown(document, { key: "j" });
    expect(row("Filtered task one")).toHaveAttribute("data-focused", "true");

    fireEvent.keyDown(document, { key: "j" });
    expect(row("Filtered task two")).toHaveAttribute("data-focused", "true");
    expect(row("Filtered task one")).not.toHaveAttribute("data-focused");
  });

  it("test_jk_pressing_k_moves_focus_back_up", () => {
    renderTable();

    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "j" });
    expect(row("Filtered task two")).toHaveAttribute("data-focused", "true");

    fireEvent.keyDown(document, { key: "k" });
    expect(row("Filtered task one")).toHaveAttribute("data-focused", "true");
  });

  it("test_jk_arrow_down_and_arrow_up_behave_the_same_as_j_and_k", () => {
    renderTable();

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(row("Filtered task one")).toHaveAttribute("data-focused", "true");

    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(row("Filtered task two")).toHaveAttribute("data-focused", "true");

    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(row("Filtered task one")).toHaveAttribute("data-focused", "true");
  });

  it("test_jk_focus_does_not_move_past_the_last_row", () => {
    renderTable();

    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "j" });
    expect(row("Filtered task three")).toHaveAttribute("data-focused", "true");
  });

  it("test_jk_enter_opens_the_focused_rows_detail_sheet", async () => {
    renderTable();

    fireEvent.keyDown(document, { key: "j" });
    fireEvent.keyDown(document, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });
  });

  it("test_jk_does_not_fire_while_typing_in_an_unrelated_input", () => {
    render(
      createElement(
        "div",
        null,
        createElement("input", { "aria-label": "unrelated input" }),
        createElement(TaskListTable, {
          tasks: TASKS,
          assignees: new Map(),
          timezone: "UTC",
        }),
      ),
    );

    const textInput = screen.getByLabelText("unrelated input");
    textInput.focus();

    fireEvent.keyDown(textInput, { key: "j" });

    expect(row("Filtered task one")).not.toHaveAttribute("data-focused");
  });

  it("test_jk_clicking_a_row_also_sets_it_as_the_keyboard_focused_row", () => {
    renderTable();

    fireEvent.click(screen.getByText("Filtered task two"));

    expect(row("Filtered task two")).toHaveAttribute("data-focused", "true");
  });
});
