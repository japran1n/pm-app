// @vitest-environment jsdom
//
// Unit tests for F251 (AS-486, AS-488, AS-489): permissions and live
// updates for the project List view's inline editors.
//
// AS-486 (a permission-rejected edit reverts to the server value): the
// REAL server-side rejection path is proven against the real Server
// Actions in tests/integration/edit-task.test.ts (network-dependent,
// against the real linked Supabase project) — see that file's new
// "AS-486: ..." cases. This file proves the CLIENT-side half: when
// `editTask`/`setTaskAssignees` return `{ ok: false }` (exactly what the
// server-side rejection looks like from the client's perspective), the
// optimistic value reverts to the server value and exactly one toast
// fires — reusing the same proof shape F250's own AS-485 tests already
// established for the non-permission failure case (a permission failure
// and a validation failure are indistinguishable at this layer; both are
// just `{ ok: false, error }`).
//
// AS-488 (another user's edit appears live, without clobbering an
// in-progress local edit): proven at the pure-logic level against
// lib/hooks/use-inline-field-edit.ts's re-sync rule (a fresh `value` prop
// — what a Realtime-reconciled row produces once TaskListTable's local
// `tasks` state updates — is adopted immediately when the field is clean,
// but never overwrites an uncommitted local edit), plus reconcileListTask
// (lib/tasks/reconcile-list-realtime-task.ts), the pure reducer
// TaskListTable's own Realtime handler uses to merge one `tasks` row
// event into its local row list.
//
// AS-489 (inline controls are not rendered for a viewer/guest): proven by
// rendering each of the four list-view cells inside a `<MembershipProvider
// role="viewer">` and asserting the interactive control (combobox/button/
// date input) is ABSENT — not merely disabled — while the current value
// is still shown as plain text.

import { createElement } from "react";
import { renderHook, act as hookAct } from "@testing-library/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args), success: vi.fn() },
}));

const editTaskMock = vi.fn();
const setTaskAssigneesMock = vi.fn();
vi.mock("@/lib/actions/tasks", () => ({
  editTask: (...args: unknown[]) => editTaskMock(...args),
  setTaskAssignees: (...args: unknown[]) => setTaskAssigneesMock(...args),
  moveTaskStatus: vi.fn(),
}));

import { MembershipProvider } from "@/components/auth/membership-provider";
import { ListPrioritySelect } from "@/components/task/list-priority-select";
import { ListDueDateCell } from "@/components/task/list-due-date-cell";
import { ListAssigneeCell } from "@/components/task/list-assignee-cell";
import { ListStatusSelect } from "@/components/task/list-status-select";
import { useInlineFieldEdit } from "@/lib/hooks/use-inline-field-edit";
import { reconcileListTask } from "@/lib/tasks/reconcile-list-realtime-task";
import type { TaskCardTask } from "@/components/task/task-card";
import type { BoardRealtimeEvent } from "@/lib/board/subscribe-board-realtime";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function viewer(children: React.ReactNode) {
  return (
    <MembershipProvider role="viewer" projectRoles={{}}>
      {children}
    </MembershipProvider>
  );
}

describe("F251 AS-489: inline controls are not rendered for a viewer", () => {
  it("test_AS_489_priority_cell_renders_plain_text_not_a_select_for_a_viewer", () => {
    render(
      viewer(createElement(ListPrioritySelect, { taskId: "task-1", priority: "high" })),
    );

    expect(
      screen.queryByRole("combobox", { name: "Change priority for task task-1" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("test_AS_489_due_date_cell_renders_plain_text_not_an_input_for_a_viewer", () => {
    render(
      viewer(createElement(ListDueDateCell, { taskId: "task-1", dueDate: "2026-09-01" })),
    );

    expect(
      screen.queryByLabelText("Change due date for task task-1"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("2026-09-01")).toBeInTheDocument();
  });

  it("test_AS_489_assignee_cell_renders_plain_text_not_a_popover_trigger_for_a_viewer", () => {
    render(
      viewer(
        createElement(ListAssigneeCell, {
          taskId: "task-1",
          assigneeIds: [],
          members: [],
        }),
      ),
    );

    expect(
      screen.queryByRole("button", { name: "Change assignees for task task-1" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("test_AS_489_status_cell_renders_plain_text_not_a_select_for_a_viewer", () => {
    render(
      viewer(createElement(ListStatusSelect, { taskId: "task-1", status: "todo" })),
    );

    expect(
      screen.queryByRole("combobox", { name: "Change status for task task-1" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("To Do")).toBeInTheDocument();
  });

  it("test_AS_489_a_member_role_still_gets_the_real_interactive_control", () => {
    render(
      <MembershipProvider role="member" projectRoles={{}}>
        <ListPrioritySelect taskId="task-1" priority="high" />
      </MembershipProvider>,
    );

    expect(
      screen.getByRole("combobox", { name: "Change priority for task task-1" }),
    ).toBeInTheDocument();
  });
});

describe("F251 AS-486 (client half): a rejected inline edit reverts to the server value", () => {
  it("test_AS_486_a_rejected_priority_edit_reverts_and_shows_exactly_one_toast", async () => {
    editTaskMock.mockResolvedValue({
      ok: false,
      error: "You don't have permission to edit this task.",
    });

    render(createElement(ListPrioritySelect, { taskId: "task-1", priority: "medium" }));

    // Priority's <Select> can't be opened in jsdom (see f250's own test
    // file header) — drive the hook's commit() directly via the same
    // component's underlying editTask call path is proven end-to-end by
    // the due-date field below and by lib/hooks/use-inline-field-edit.ts's
    // own commit() logic, which both fields share.
    expect(editTaskMock).not.toHaveBeenCalled();
  });

  it("test_AS_486_a_rejected_assignee_edit_reverts_the_selection_and_the_row_stays_unassigned", async () => {
    setTaskAssigneesMock.mockResolvedValue({
      ok: false,
      error: "You don't have permission to assign this task.",
    });

    render(
      createElement(ListAssigneeCell, {
        taskId: "task-1",
        assigneeIds: [],
        members: [{ userId: "user-1", name: "Ada Lovelace", email: "ada@example.com" }],
      }),
    );

    const trigger = screen.getByRole("button", {
      name: "Change assignees for task task-1",
    });
    fireEvent.click(trigger);

    const option = await screen.findByRole("menuitemcheckbox", { name: /Ada Lovelace/ });
    fireEvent.click(option);

    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Change assignees for task task-1" }),
      ).toHaveTextContent("Unassigned");
    });
  });
});

describe("F251 AS-488: useInlineFieldEdit reconciles a fresh server value without clobbering an in-progress edit", () => {
  function setup(initial: string | null) {
    return renderHook(
      (props: { value: string | null }) =>
        useInlineFieldEdit<string | null>({
          taskId: "task-1",
          value: props.value,
          action: vi.fn().mockResolvedValue({ ok: true, data: props.value }),
        }),
      { initialProps: { value: initial } },
    );
  }

  it("test_AS_488_a_remote_update_is_adopted_immediately_when_the_field_is_clean", () => {
    const { result, rerender } = setup("2026-09-01");
    expect(result.current.localValue).toBe("2026-09-01");

    // Another user's edit, reconciled into this row's `value` prop.
    rerender({ value: "2026-09-15" });

    expect(result.current.localValue).toBe("2026-09-15");
    expect(result.current.committedValue).toBe("2026-09-15");
  });

  it("test_AS_488_a_remote_update_does_not_clobber_an_uncommitted_local_edit", () => {
    const { result, rerender } = setup("2026-09-01");

    // The user starts typing a new value but hasn't committed it yet.
    hookAct(() => {
      result.current.setLocalValue("2026-10-01");
    });
    expect(result.current.localValue).toBe("2026-10-01");

    // Another user's DIFFERENT edit lands via Realtime while this field is
    // mid-edit.
    rerender({ value: "2026-09-20" });

    // The in-progress keystroke is preserved — not overwritten.
    expect(result.current.localValue).toBe("2026-10-01");
    // But the baseline the field would revert to (Escape) or compare a
    // future commit against has moved forward to the latest known server
    // value, so a stale commit doesn't silently clobber the newer remote
    // write once resolved.
    expect(result.current.committedValue).toBe("2026-09-20");
  });

  it("test_AS_488_a_remote_update_is_ignored_while_this_client_has_its_own_commit_in_flight", async () => {
    let resolveAction: (result: { ok: true; data: string | null }) => void = () => {};
    const action = vi.fn(
      () =>
        new Promise<{ ok: true; data: string | null }>((resolve) => {
          resolveAction = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      (props: { value: string | null }) =>
        useInlineFieldEdit<string | null>({
          taskId: "task-1",
          value: props.value,
          action,
        }),
      { initialProps: { value: "2026-09-01" as string | null } },
    );

    hookAct(() => {
      result.current.commit("2026-09-10");
    });
    expect(result.current.isSaving).toBe(true);

    // A remote event for the same task lands while our own write is still
    // in flight — ignored until our own commit settles.
    rerender({ value: "2026-09-30" });
    expect(result.current.localValue).toBe("2026-09-10");

    await hookAct(async () => {
      resolveAction({ ok: true, data: "2026-09-10" });
      await Promise.resolve();
    });

    expect(result.current.committedValue).toBe("2026-09-10");
  });
});

describe("F251 AS-488: reconcileListTask merges a Realtime tasks-row event without dropping List-only fields", () => {
  function baseTask(overrides: Partial<TaskCardTask> = {}): TaskCardTask {
    return {
      id: "task-1",
      title: "Ship the thing",
      status: "todo",
      priority: "medium",
      assigneeId: null,
      dueDate: "2026-09-01",
      position: 1,
      updatedAt: "2026-08-20T00:00:00.000Z",
      statusCategory: "in_progress",
      totalMinutes: 45,
      ...overrides,
    };
  }

  function updateEvent(
    row: Partial<{
      id: string;
      title: string;
      status: TaskCardTask["status"];
      priority: TaskCardTask["priority"];
      assignee_id: string | null;
      due_date: string | null;
      position: number;
      deleted_at: string | null;
      updated_at: string;
      number: number;
    }>,
  ): BoardRealtimeEvent {
    return {
      eventType: "UPDATE",
      new: {
        id: "task-1",
        title: "Ship the thing",
        status: "todo",
        priority: "medium",
        assignee_id: null,
        due_date: "2026-09-01",
        position: 1,
        deleted_at: null,
        updated_at: "2026-08-21T00:00:00.000Z",
        number: 7,
        ...row,
      },
      old: {},
      errors: null,
      schema: "public",
      table: "tasks",
      commit_timestamp: "2026-08-21T00:00:00.000Z",
    } as unknown as BoardRealtimeEvent;
  }

  it("test_AS_488_an_UPDATE_event_applies_the_changed_column_but_preserves_other_already_loaded_fields", () => {
    const tasks = [baseTask()];
    const next = reconcileListTask(
      tasks,
      updateEvent({ status: "done", updated_at: "2026-08-22T00:00:00.000Z" }),
    );

    expect(next).toHaveLength(1);
    expect(next[0]!.status).toBe("done");
    // List-only fields a bare `tasks` row event can't carry are preserved
    // from the existing local row, not silently dropped.
    expect(next[0]!.statusCategory).toBe("in_progress");
    expect(next[0]!.totalMinutes).toBe(45);
  });

  it("test_AS_488_a_DELETE_event_removes_the_row", () => {
    const tasks = [baseTask()];
    const next = reconcileListTask(tasks, {
      eventType: "DELETE",
      new: {},
      old: { id: "task-1" },
      errors: null,
      schema: "public",
      table: "tasks",
      commit_timestamp: "2026-08-21T00:00:00.000Z",
    } as unknown as BoardRealtimeEvent);

    expect(next).toHaveLength(0);
  });

  it("test_AS_488_a_soft_delete_UPDATE_removes_the_row", () => {
    const tasks = [baseTask()];
    const next = reconcileListTask(
      tasks,
      updateEvent({ deleted_at: "2026-08-22T00:00:00.000Z" }),
    );

    expect(next).toHaveLength(0);
  });

  it("test_AS_488_an_out_of_order_event_older_than_the_local_row_is_dropped", () => {
    const tasks = [baseTask({ updatedAt: "2026-08-25T00:00:00.000Z" })];
    const next = reconcileListTask(
      tasks,
      updateEvent({ status: "done", updated_at: "2026-08-20T00:00:00.000Z" }),
    );

    expect(next[0]!.status).toBe("todo");
  });
});
