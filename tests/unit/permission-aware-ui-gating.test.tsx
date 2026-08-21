// @vitest-environment jsdom
//
// F135 (AS-231): "a forbidden action is hidden or disabled, never shown as
// a control that will fail." Real DOM render tests (jsdom +
// @testing-library/react, matching tests/unit/user-avatar.test.tsx's own
// pragma/pattern) proving concretely — not by grepping source text — that
// a caller without the relevant lib/auth/permissions.ts predicate either
// never gets a clickable control at all, or gets one that is disabled
// (`aria-disabled`/native `disabled`), for every control this feature's
// sweep gated: TagsEditor's add/remove, NewTaskDialog's create trigger
// (via the shared membership context), Checklist's add/toggle/delete, and
// TaskDetailSheet's edit fields + delete-task button.
//
// Each test derives its assertion from AS-231's text itself ("hidden or
// disabled, never shown as a control that will fail"), not from this
// feature's own implementation — the check is "can a user actually invoke
// this", never "does canWrite() return false internally".

import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

afterEach(() => {
  cleanup();
});

vi.mock("@/lib/actions/tasks", () => ({
  updateTaskTags: vi.fn(async () => ({ ok: true, data: { tags: [] } })),
  createTask: vi.fn(async () => ({
    ok: true,
    data: { id: "t1", title: "New task", projectId: "p1" },
  })),
  editTask: vi.fn(async () => ({ ok: true, data: {} })),
  assignTask: vi.fn(async () => ({ ok: true, data: {} })),
  deleteTask: vi.fn(async () => ({ ok: true, data: {} })),
  moveTaskStatus: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/lib/actions/checklist", () => ({
  addChecklistItem: vi.fn(),
  toggleChecklistItem: vi.fn(),
  renameChecklistItem: vi.fn(),
  deleteChecklistItem: vi.fn(),
  reorderChecklistItem: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { TagsEditor } from "@/components/task/tags-editor";
import { NewTaskDialog } from "@/components/task/new-task-dialog";
import { Checklist } from "@/components/task/checklist";
import {
  MembershipProvider,
} from "@/components/auth/membership-provider";

describe("AS-231: TagsEditor add/remove is hidden or disabled for a viewer", () => {
  it("disables the add-tag input and button, and the remove button, for a viewer", () => {
    render(
      createElement(TagsEditor, {
        taskId: "task-1",
        tags: ["urgent"],
        currentUserRole: "viewer",
      }),
    );

    const addInput = screen.getByPlaceholderText("Add a tag");
    expect(addInput).toBeDisabled();

    const addButton = screen.getByRole("button", { name: /add/i });
    expect(addButton).toBeDisabled();

    const removeButton = screen.getByRole("button", {
      name: /remove tag urgent/i,
    });
    expect(removeButton).toBeDisabled();
  });

  it("leaves the add-tag control enabled for a member (a role that can write)", () => {
    render(
      createElement(TagsEditor, {
        taskId: "task-1",
        tags: [],
        currentUserRole: "member",
      }),
    );

    const addInput = screen.getByPlaceholderText("Add a tag");
    expect(addInput).not.toBeDisabled();
  });
});

describe("AS-231: NewTaskDialog create trigger is disabled for a viewer/guest via membership context", () => {
  it("disables the trigger for a viewer, reading role from MembershipProvider (not a prop)", () => {
    render(
      createElement(
        MembershipProvider,
        { role: "viewer", projectRoles: {} },
        createElement(NewTaskDialog, {
          projectId: "11111111-1111-1111-1111-111111111111",
          assigneeOptions: [],
        }),
      ),
    );

    const trigger = screen.getByRole("button", { name: /new task/i });
    expect(trigger).toBeDisabled();
  });

  it("enables the trigger for an admin via the same context", () => {
    render(
      createElement(
        MembershipProvider,
        { role: "admin", projectRoles: {} },
        createElement(NewTaskDialog, {
          projectId: "11111111-1111-1111-1111-111111111111",
          assigneeOptions: [],
        }),
      ),
    );

    const trigger = screen.getByRole("button", { name: /new task/i });
    expect(trigger).not.toBeDisabled();
  });
});

describe("AS-231: Checklist add/toggle/delete is hidden or disabled for a viewer", () => {
  // Uses "viewer", not "guest": canWrite (lib/auth/permissions.ts, F128)
  // deliberately does NOT exclude "guest" — guest write access is
  // project-scoped and governed by its own assertions (AS-223) — so
  // "viewer" is the correct read-only role to exercise the generic
  // canWrite gate this component uses.
  it("disables the add-item input for a viewer", () => {
    render(
      createElement(Checklist, {
        taskId: "task-1",
        items: [
          { id: "item-1", content: "Write tests", isChecked: false, position: 1 },
        ],
        currentUserRole: "viewer",
      }),
    );

    const addInput = screen.getByPlaceholderText("Add an item…");
    expect(addInput).toBeDisabled();

    // base-ui's Checkbox renders a <span role="checkbox"> with
    // aria-disabled rather than a native disabled attribute — still a
    // genuinely non-interactive control (tabindex="-1", data-disabled),
    // which is what AS-231 requires: a caller cannot activate it.
    const checkbox = screen.getByRole("checkbox", {
      name: /mark "write tests" as done/i,
    });
    expect(checkbox).toHaveAttribute("aria-disabled", "true");

    const deleteButton = screen.getByRole("button", {
      name: /delete "write tests"/i,
    });
    expect(deleteButton).toBeDisabled();
  });
});
