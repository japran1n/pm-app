// @vitest-environment jsdom
//
// F002 (missions/20260903-portal, AS-013): TaskDetailSheet's Phase Select
// updates its value the instant a new phase is chosen — before
// setTaskPhase's server round trip resolves — and reverts, with an error
// toast, if the server rejects the change.
//
// Mirrors tests/unit/f004-task-detail-sheet-priority-optimistic.test.tsx's
// own pattern exactly (see that file's doc comment for the full rationale
// behind mounting the real <Board> and mocking @/components/ui/select with
// a bare native <select>) — this feature's own Priority Select is the
// direct model for the Phase Select's optimistic pattern.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "test-publishable-key";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

let latestValue: string | undefined;
let latestOnValueChange: ((value: string | null) => void) | null = null;
let latestId: string | undefined;
let latestDisabled: boolean | undefined;

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
  }) => {
    latestValue = value;
    latestOnValueChange = onValueChange;
    latestDisabled = disabled;
    return createElement(Fragment, null, children);
  },
  SelectTrigger: ({ id, children }: { id?: string; children: ReactNode }) => {
    latestId = id;
    return createElement(Fragment, null, children);
  },
  SelectContent: ({ children }: { children: ReactNode }) => {
    // Snapshot at THIS render — several <Select> instances share the same
    // module-level `latest*` variables (board's group-by, status, priority,
    // and now this phase select) — see F003/F004's own tests for the full
    // explanation of why a per-instance snapshot is required.
    const onValueChange = latestOnValueChange;
    const id = latestId;
    const disabled = latestDisabled;
    const value = latestValue;
    return createElement(
      "select",
      {
        id,
        disabled,
        value,
        onChange: (e: { target: { value: string } }) =>
          onValueChange?.(e.target.value),
      },
      children,
    );
  },
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) =>
    createElement("option", { value }, children),
  SelectValue: ({
    children,
  }: {
    children?: (value: string) => ReactNode;
    placeholder?: string;
  }) => {
    const value = latestValue;
    if (typeof children === "function" && value !== undefined) {
      return children(value);
    }
    return null;
  },
}));

// Resolved manually per-test so the "instant" optimistic update can be
// observed BEFORE the server call settles.
let resolveSetTaskPhase: ((value: unknown) => void) | null = null;
const setTaskPhase = vi.fn(
  (_taskId: string, _phaseId: string | null) =>
    new Promise((resolve) => {
      resolveSetTaskPhase = resolve;
    }),
);

vi.mock("@/lib/actions/phases", () => ({
  getProjectPhaseOptions: vi.fn(async () => ({
    ok: true,
    data: {
      phases: [
        { id: "phase-1", name: "Discovery", state: "active", position: 1 },
        { id: "phase-2", name: "Build", state: "not_started", position: 2 },
      ],
    },
  })),
  setTaskPhase: (taskId: string, phaseId: string | null) =>
    setTaskPhase(taskId, phaseId),
}));

vi.mock("@/lib/actions/tasks", () => ({
  moveAndReorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  reorderTask: vi.fn(async () => ({ ok: true, data: {} })),
  createTask: vi.fn(async () => ({ ok: true, data: {} })),
  editTask: vi.fn(async () => ({ ok: true, data: {} })),
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: {} })),
  getOpenBlockers: vi.fn(async () => ({ ok: true, data: [] })),
  getTaskDetail: vi.fn(async (taskId: string) => ({
    ok: true,
    data: {
      task: {
        id: taskId,
        title: "Phase task",
        description: null,
        status: "todo",
        priority: null,
        assigneeId: null,
        dueDate: null,
        tags: [],
        projectId: "project-1",
        phaseId: null,
      },
      comments: [],
      attachments: [],
      currentUserId: "user-1",
      currentUserRole: "member",
    },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/w/acme/projects/proj-1/board",
  useSearchParams: () => new URLSearchParams("taskId=t1"),
}));

vi.mock("@/lib/actions/comments", () => ({
  getMentionCandidates: vi.fn(async () => ({ ok: true, data: [] })),
}));

import { Board } from "@/components/board/board";
import { getTaskDetail } from "@/lib/actions/tasks";
import type { TaskCardTask } from "@/components/task/task-card";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  resolveSetTaskPhase = null;
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Phase task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetPhaseSelect() {
  render(
    createElement(Board, {
      projectId: "project-1",
      initialTasks: TASKS,
      timezone: "UTC",
    }),
  );

  await waitFor(() => expect(getTaskDetail).toHaveBeenCalledWith("t1"));
  await waitFor(() =>
    expect(
      screen.getByDisplayValue("Phase task", { exact: false }),
    ).toBeInTheDocument(),
  );

  // The phase Select is disabled until getProjectPhaseOptions resolves —
  // wait for that before returning the control to the caller.
  await waitFor(() =>
    expect((screen.getByLabelText("Phase") as HTMLSelectElement).disabled).toBe(
      false,
    ),
  );

  return screen.getByLabelText("Phase") as HTMLSelectElement;
}

describe("TaskDetailSheet phase Select optimistic update (F002, AS-013)", () => {
  it("test_AS_013_phase_updates_immediately_before_the_server_responds", async () => {
    const phaseSelect = await openSheetAndGetPhaseSelect();
    expect(phaseSelect.value).toBe("__no_phase__");

    fireEvent.change(phaseSelect, { target: { value: "phase-1" } });

    // Assert the optimistic value is applied before setTaskPhase's promise
    // has resolved at all — proves the Select did not wait on the server.
    await waitFor(() => expect(phaseSelect.value).toBe("phase-1"));
    expect(setTaskPhase).toHaveBeenCalledWith("t1", "phase-1");
    expect(resolveSetTaskPhase).not.toBeNull();

    resolveSetTaskPhase?.({ ok: true, data: { id: "t1", phaseId: "phase-1" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Phase updated."));
    expect(phaseSelect.value).toBe("phase-1");
  });

  it("test_AS_013_phase_reverts_and_shows_an_error_toast_on_server_failure", async () => {
    const phaseSelect = await openSheetAndGetPhaseSelect();

    fireEvent.change(phaseSelect, { target: { value: "phase-2" } });
    await waitFor(() => expect(phaseSelect.value).toBe("phase-2"));

    resolveSetTaskPhase?.({ ok: false, error: "Something went wrong." });

    await waitFor(() => expect(phaseSelect.value).toBe("__no_phase__"));
    expect(toastError).toHaveBeenCalledWith("Something went wrong.");
  });

  it("test_AS_013_assigning_a_task_to_a_phase_survives_being_re-synced_from_a_reload (phaseId prop reflected once confirmed)", async () => {
    // Simulates the reload half of AS-013: once the caller's own
    // refetch/realtime path catches up and re-renders with the new
    // `task.phaseId` from the server, the Select must show it — proving
    // the assignment is real, DB-backed state, not just this component's
    // own local optimistic mirror.
    (getTaskDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (taskId: string) => ({
        ok: true,
        data: {
          task: {
            id: taskId,
            title: "Phase task",
            description: null,
            status: "todo",
            priority: null,
            assigneeId: null,
            dueDate: null,
            tags: [],
            projectId: "project-1",
            phaseId: "phase-2",
          },
          comments: [],
          attachments: [],
          currentUserId: "user-1",
          currentUserRole: "member",
        },
      }),
    );

    const phaseSelect = await openSheetAndGetPhaseSelect();
    expect(phaseSelect.value).toBe("phase-2");
  });
});
