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
//
// F006c (missions/20260903-portal, M1-scrutiny.md FU-3): the
// getTaskDetail mock below is typed against `GetTaskDetailResult`
// (lib/actions/tasks.ts's own exported return type), not a hand-shaped
// object — the lesson M1-scrutiny.md's B3 drew from this exact file: a
// unit test that mocks a server action's return value from an untyped
// literal can invent a field the real function never returns
// (`phaseId: "phase-2"` was added here before `getTaskDetail` selected
// or returned `phase_id` at all — see F006c's own handoff), which proves
// only that the mock works, never that the real read path does. Typing
// the literal against the exported type turns a missing/invented field
// into a compile error instead. The actual "does a real assignment
// survive a real reload" claim is proven by
// tests/integration/f002-phase-management.test.ts's
// test_AS_013_getTaskDetail_returns_the_phase_a_reload_would_show,
// which calls the REAL getTaskDetail — nothing in this jsdom file ever
// asserts persistence, only that this component reflects whatever
// `task.phaseId` its data source (real or mocked) reports.

import { createElement, Fragment, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { GetTaskDetailResult } from "@/lib/actions/tasks";

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
  getTaskDetail: vi.fn(
    async (taskId: string): Promise<GetTaskDetailResult> => ({
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
          startDate: null,
          tags: [],
          projectId: "project-1",
          phaseId: null,
        },
        comments: [],
        attachments: [],
        currentUserId: "user-1",
        currentUserRole: "member",
      },
    }),
  ),
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

  it("test_AS_013_the_phase_select_reflects_whatever_phaseId_its_data_source_reports", async () => {
    // This is a UI-reflection test only: it proves the Select renders
    // whatever `task.phaseId` it's given, not that a reload of a REAL
    // task actually reports the phase back — that claim (the actual
    // "reload" half of AS-013) is proven against the real getTaskDetail
    // by tests/integration/f002-phase-management.test.ts's
    // test_AS_013_getTaskDetail_returns_the_phase_a_reload_would_show,
    // per this feature's own "do not repeat that shape here" instruction
    // and M1-scrutiny.md's FU-3. The mocked return value below is typed
    // against `GetTaskDetailResult` (see this file's own header comment),
    // so a field that doesn't exist on the real type is a compile error
    // here, not a silently-passing green test.
    (getTaskDetail as ReturnType<typeof vi.fn>).mockImplementationOnce(
      async (taskId: string): Promise<GetTaskDetailResult> => ({
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
            startDate: null,
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
