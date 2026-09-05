// @vitest-environment jsdom
//
// F118 (AS-066, AS-067): an existing task's type can be changed from the
// task detail view, visible immediately without a page reload (AS-066),
// and that write never touches the task's own `client_visible` flag
// (AS-067). Mirrors
// tests/unit/f002-task-detail-sheet-phase-optimistic.test.tsx's own
// pattern exactly.

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
  SelectValue: () => null,
}));

let resolveSetTaskType: ((value: unknown) => void) | null = null;
const setTaskType = vi.fn(
  (input: unknown) =>
    new Promise((resolve) => {
      void input;
      resolveSetTaskType = resolve;
    }),
);

vi.mock("@/lib/actions/task-types", () => ({
  getProjectTaskTypeOptions: vi.fn(async () => ({
    ok: true,
    data: {
      taskTypes: [
        { id: "type-delivery", name: "Delivery", color: "#111111", position: 1, systemKey: "delivery", isBillable: true },
        { id: "type-qa", name: "QA issue", color: "#222222", position: 2, systemKey: "qa", isBillable: false },
      ],
    },
  })),
  setTaskType: (input: unknown) => setTaskType(input),
}));

vi.mock("@/lib/actions/phases", () => ({
  getProjectPhaseOptions: vi.fn(async () => ({ ok: true, data: { phases: [] } })),
  setTaskPhase: vi.fn(async () => ({ ok: true, data: {} })),
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
          title: "Typed task",
          description: null,
          status: "todo",
          priority: null,
          assigneeId: null,
          dueDate: null,
          startDate: null,
          tags: [],
          projectId: "project-1",
          taskTypeId: "type-delivery",
          taskTypeName: "Delivery",
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
  vi.clearAllMocks();
  resolveSetTaskType = null;
});

const TASKS: TaskCardTask[] = [
  {
    id: "t1",
    title: "Typed task",
    status: "todo",
    priority: null,
    assigneeId: null,
    dueDate: null,
    position: 1000,
  },
];

async function openSheetAndGetTypeSelect() {
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
      screen.getByDisplayValue("Typed task", { exact: false }),
    ).toBeInTheDocument(),
  );

  return (await waitFor(() =>
    screen.getByLabelText("Type"),
  )) as HTMLSelectElement;
}

describe("TaskDetailSheet task type editor (F118, AS-066, AS-067)", () => {
  it("test_AS_066_an_existing_tasks_type_can_be_changed_and_is_visible_immediately_without_reload", async () => {
    const typeSelect = await openSheetAndGetTypeSelect();
    expect(typeSelect.value).toBe("type-delivery");

    fireEvent.change(typeSelect, { target: { value: "type-qa" } });

    // Reflected immediately, before setTaskType's server round trip
    // resolves at all — proves this is an in-memory UI update, not a
    // page reload/refetch waiting on the network.
    await waitFor(() => expect(typeSelect.value).toBe("type-qa"));
    expect(setTaskType).toHaveBeenCalledWith({ taskId: "t1", taskTypeId: "type-qa" });
    expect(resolveSetTaskType).not.toBeNull();

    resolveSetTaskType?.({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Task type updated."));
    expect(typeSelect.value).toBe("type-qa");
  });

  it("test_AS_067_changing_a_tasks_type_never_touches_client_visible", async () => {
    const typeSelect = await openSheetAndGetTypeSelect();

    fireEvent.change(typeSelect, { target: { value: "type-qa" } });
    await waitFor(() => expect(setTaskType).toHaveBeenCalled());

    // The ONLY payload setTaskType ever receives is { taskId, taskTypeId }
    // — no clientVisible/client_visible field, in either direction.
    const payload = setTaskType.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["taskId", "taskTypeId"]);
    expect(payload).not.toHaveProperty("clientVisible");
    expect(payload).not.toHaveProperty("client_visible");

    resolveSetTaskType?.({ ok: true });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("test_AS_066_type_change_reverts_and_shows_an_error_toast_on_server_failure", async () => {
    const typeSelect = await openSheetAndGetTypeSelect();

    fireEvent.change(typeSelect, { target: { value: "type-qa" } });
    await waitFor(() => expect(typeSelect.value).toBe("type-qa"));

    resolveSetTaskType?.({ ok: false, error: "Something went wrong." });

    await waitFor(() => expect(typeSelect.value).toBe("type-delivery"));
    expect(toastError).toHaveBeenCalledWith("Something went wrong.");
  });
});
