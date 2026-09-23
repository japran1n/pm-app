// @vitest-environment jsdom
//
// F019 (TT-050, TT-052): the New Task dialog's two-column layout — left
// column (title/description/type), right column (project/phase,
// assignees, priority, dates, estimate, tags, billing). Mirrors
// tests/unit/f118-new-task-dialog-type-picker.test.tsx's own render setup
// (same "mock @/components/ui/select with a bare native <select>"
// pattern) since this dialog reuses those same Select instances.

import { createElement, Fragment, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string | null) => void;
    disabled?: boolean;
    children: ReactNode;
  }) => createElement(Fragment, null, children),
  SelectTrigger: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectContent: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectItem: ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children),
  SelectValue: () => null,
}));

const createTask = vi.fn(async () => ({
  ok: true,
  data: { id: "t1", title: "New task", projectId: "p1" },
}));
const editTask = vi.fn(async () => ({ ok: true, data: {} }));
const updateTaskTags = vi.fn(async () => ({ ok: true, data: {} }));

vi.mock("@/lib/actions/tasks", () => ({
  createTask: (...args: Parameters<typeof createTask>) => createTask(...args),
  setTaskAssignees: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: (...args: Parameters<typeof editTask>) => editTask(...args),
  updateTaskTags: (...args: Parameters<typeof updateTaskTags>) =>
    updateTaskTags(...args),
}));

vi.mock("@/lib/actions/phases", () => ({
  getProjectPhaseOptions: vi.fn(async () => ({ ok: true, data: { phases: [] } })),
  setTaskPhase: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/actions/task-types", () => ({
  getProjectTaskTypeOptions: vi.fn(async () => ({
    ok: true,
    data: { taskTypes: [] },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { NewTaskDialog } from "@/components/task/new-task-dialog";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("NewTaskDialog two-column layout (F019, TT-050)", () => {
  it("test_TT_050_renders_left_and_right_column_fields_including_estimate_tags_and_billing", async () => {
    render(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [{ id: "u1", label: "Ada Lovelace" }],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));

    await waitFor(() => screen.getByLabelText("Title"));
    // Left column
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Description (optional)"),
    ).toBeInTheDocument();
    // Right column: assignees, priority, dates, estimate, tags, billing
    expect(screen.getByText("Assignees (optional)")).toBeInTheDocument();
    expect(screen.getByText("Priority (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toBeInTheDocument();
    expect(screen.getByLabelText("Estimate (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Tags (optional)")).toBeInTheDocument();
    expect(screen.getByLabelText("Billable")).toBeInTheDocument();
  });

  it("test_TT_050_estimate_text_like_2h_is_parsed_and_saved_via_editTask_after_create", async () => {
    render(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    await waitFor(() => screen.getByLabelText("Title"));

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Ship the thing" },
    });
    fireEvent.change(screen.getByLabelText("Estimate (optional)"), {
      target: { value: "2h" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    await waitFor(() =>
      expect(editTask).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ estimateMinutes: 120 }),
      ),
    );
  });

  it("test_TT_050_tags_are_split_trimmed_and_saved_via_updateTaskTags_after_create", async () => {
    render(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    await waitFor(() => screen.getByLabelText("Title"));

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Tag me" },
    });
    fireEvent.change(screen.getByLabelText("Tags (optional)"), {
      target: { value: "design,  urgent " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() => expect(createTask).toHaveBeenCalled());
    await waitFor(() =>
      expect(updateTaskTags).toHaveBeenCalledWith("t1", ["design", "urgent"]),
    );
  });

  it("test_TT_052_empty_title_blocks_submit_and_never_calls_createTask", async () => {
    render(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    await waitFor(() => screen.getByLabelText("Title"));

    // Whitespace-only title bypasses the native `required` HTML
    // constraint (non-empty per the DOM) but must still trim to empty and
    // block submission, per TT-052 ("Validation (title required)
    // unchanged").
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Task title is required.",
      ),
    );
    expect(createTask).not.toHaveBeenCalled();
  });

  it("test_TT_050_invalid_estimate_text_blocks_submit_with_a_field_level_error", async () => {
    render(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [],
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    await waitFor(() => screen.getByLabelText("Title"));

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Bad estimate" },
    });
    fireEvent.change(screen.getByLabelText("Estimate (optional)"), {
      target: { value: "abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Task" }));

    await waitFor(() =>
      expect(
        screen.getByText('Enter an estimate like "2h" or "90m".'),
      ).toBeInTheDocument(),
    );
    expect(createTask).not.toHaveBeenCalled();
  });
});
