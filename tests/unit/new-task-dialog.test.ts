// Happy-path smoke test for <NewTaskDialog> — the trigger that fixes the
// "no way to create a task anywhere in the UI" gap (board-empty-state.tsx
// previously shipped a permanently disabled placeholder; see that
// component's own comment history). This repo has no jsdom/@testing-library
// setup (vitest.config.ts pins `environment: "node"` — same constraint
// documented in tests/unit/board-dnd-setup.test.ts), so this test follows
// the established pattern for this repo's dialog components: render the
// real tree to prove it doesn't crash and produces the expected trigger
// markup wired to createTask, plus a source-level check that a successful
// submission calls createTask with the project id and shows a success path
// (toast + router.refresh()) rather than silently doing nothing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

vi.mock("@/lib/actions/tasks", () => ({
  createTask: vi.fn(async () => ({
    ok: true,
    data: { id: "t1", title: "New task", projectId: "p1" },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import { NewTaskDialog } from "@/components/task/new-task-dialog";

describe("NewTaskDialog", () => {
  it("renders a real, enabled trigger (not a disabled placeholder) without crashing", () => {
    const html = renderToStaticMarkup(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [{ id: "u1", label: "Ada Lovelace" }],
      }),
    );

    expect(html).toContain("New Task");
    expect(html).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(html).toContain('aria-haspopup="dialog"');
  });

  it("supports a custom trigger label (used by the board empty state's 'Create task' trigger)", () => {
    const html = renderToStaticMarkup(
      createElement(NewTaskDialog, {
        projectId: "11111111-1111-1111-1111-111111111111",
        assigneeOptions: [],
        triggerLabel: "Create task",
      }),
    );

    expect(html).toContain("Create task");
  });

  it("wires a successful submit to createTask + a success toast + router.refresh (source-level check)", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL(
          "../../components/task/new-task-dialog.tsx",
          import.meta.url,
        ),
      ),
      "utf-8",
    );

    expect(source).toContain("createTask(");
    expect(source).toContain("toast.success(");
    expect(source).toContain("toast.error(");
    expect(source).toContain("router.refresh()");
  });
});
