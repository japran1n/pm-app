// @vitest-environment jsdom
//
// Mission 20260919-150607, F014 (AS-058, AS-059): the discipline estimate
// popover renders a row for every one of the five canonical work
// categories (design, development, content_seo, pm, qa) with the correct
// human-readable label for each -- not just the two ("design"/"development")
// that existed before F011 widened WorkCategory/WORK_CATEGORIES to five
// values.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toastError = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/architecture", () => ({
  setDisciplineEstimatesBulk: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));

import { DisciplineEstimatePopover } from "./discipline-estimate-popover";
import { WORK_CATEGORIES } from "@/lib/architecture/types";
import { setDisciplineEstimatesBulk } from "@/lib/actions/architecture";
import { ArchitectureActionsProvider } from "@/lib/architecture/actions-context";
import type { ArchitectureActions } from "@/lib/architecture/actions-context";

afterEach(() => {
  cleanup();
});

const testActions: ArchitectureActions = {
  createSection: vi.fn(),
  deleteSection: vi.fn(),
  renameSection: vi.fn(),
  reorderSections: vi.fn(),
  moveSectionToPage: vi.fn(),
  changeSectionKind: vi.fn(),
  createPage: vi.fn(),
  changePageKind: vi.fn(),
  changePageSlug: vi.fn(),
  renamePage: vi.fn(),
  deletePage: vi.fn(),
  reorderPages: vi.fn(),
  importPages: vi.fn(),
  readOnly: false,
  estimates: {
    setDisciplineEstimatesBulk,
    getNodeDetailsForToggle: vi.fn(),
  },
} as unknown as ArchitectureActions;

function renderPopover(props: React.ComponentProps<typeof DisciplineEstimatePopover>) {
  return render(
    <ArchitectureActionsProvider actions={testActions}>
      <DisciplineEstimatePopover {...props} />
    </ArchitectureActionsProvider>,
  );
}

describe("DisciplineEstimatePopover (AS-058, AS-059)", () => {
  it("test_AS_058_renders_a_row_for_only_the_two_visible_disciplines", () => {
    renderPopover({ taskId: "task-1", taskTitle: "Task 1", estimates: [] });

    // WORK_CATEGORIES remains the DB/actions source of truth for all five
    // disciplines, but the popover UI only surfaces design + development
    // (content_seo/pm/qa stay valid in the DB but are hidden here).
    expect(WORK_CATEGORIES.length).toBe(5);
    const inputs = screen.getAllByPlaceholderText("—");
    expect(inputs).toHaveLength(2);
  });

  it("test_AS_059_shows_the_correct_label_for_each_visible_discipline", () => {
    renderPopover({ taskId: "task-1", taskTitle: "Task 1", estimates: [] });

    expect(screen.getByText("Design")).toBeInTheDocument();
    expect(screen.getByText("Development")).toBeInTheDocument();
    expect(screen.queryByText("Content & SEO")).not.toBeInTheDocument();
    expect(screen.queryByText("PM")).not.toBeInTheDocument();
    expect(screen.queryByText("QA")).not.toBeInTheDocument();
  });

  it("test_AS_079_handleSaveAll_calls_bulk_action_exactly_once", async () => {
    toastError.mockClear();
    const mockedBulk = vi.mocked(setDisciplineEstimatesBulk);
    mockedBulk.mockReset();
    mockedBulk.mockResolvedValue({ success: true } as never);

    renderPopover({ taskId: "task-1", taskTitle: "Task 1", estimates: [] });

    const inputs = screen.getAllByPlaceholderText("—");
    // Fill all five inputs so every discipline is included in the payload.
    for (const input of inputs) {
      fireEvent.change(input, { target: { value: "1h" } });
    }

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockedBulk).toHaveBeenCalledTimes(1);
    });

    // A single call carrying all five disciplines -- not a loop of five
    // individual calls (the pre-F021 behaviour).
    const [taskIdArg, entriesArg] = mockedBulk.mock.calls[0] as [
      string,
      Array<{ discipline: string; input: string }>,
    ];
    expect(taskIdArg).toBe("task-1");
    expect(entriesArg).toHaveLength(WORK_CATEGORIES.length);
  });

  it("test_AS_078_rejected_bulk_call_shows_error_and_does_not_close", async () => {
    toastError.mockClear();
    const mockedBulk = vi.mocked(setDisciplineEstimatesBulk);
    mockedBulk.mockReset();
    mockedBulk.mockResolvedValue({ success: false, error: "boom" } as never);

    const onClose = vi.fn();
    renderPopover({ taskId: "task-1", taskTitle: "Task 1", estimates: [], onClose });

    const inputs = screen.getAllByPlaceholderText("—");
    for (const input of inputs) {
      fireEvent.change(input, { target: { value: "1h" } });
    }

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("boom");
    });

    expect(mockedBulk).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
