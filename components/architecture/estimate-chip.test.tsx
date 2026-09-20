// @vitest-environment jsdom
//
// F084: regression test for the race where `detailsData` in
// architecture-view-toggle.tsx resolves ~1.75s after a page reload. During
// that window the chip's `estimates` prop reads as `[]` even when the DB
// holds real values, and saving through the popover in that state wipes
// every discipline (setDisciplineEstimatesBulk treats an empty input as
// "clear"). The fix disables the chip -- and keeps its popover closed --
// while the caller marks it `loading`, so the race can no longer reach the
// destructive save path.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/architecture", () => ({
  setDisciplineEstimatesBulk: vi.fn(),
}));

import { EstimateChip } from "./estimate-chip";
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
    setDisciplineEstimatesBulk: vi.fn(),
    getNodeDetailsForToggle: vi.fn(),
  },
} as unknown as ArchitectureActions;

function renderChip(props: React.ComponentProps<typeof EstimateChip>) {
  return render(
    <ArchitectureActionsProvider actions={testActions}>
      <EstimateChip {...props} />
    </ArchitectureActionsProvider>,
  );
}

describe("EstimateChip (F084)", () => {
  it("test_F084_chip_is_disabled_while_loading_even_with_empty_estimates", () => {
    renderChip({ taskId: "task-1", taskTitle: "Task 1", estimates: [], loading: true });

    const button = screen.getByRole("button", { name: "Estimate for Task 1" });
    expect(button).toBeDisabled();
  });

  it("test_F084_clicking_the_chip_while_loading_does_not_open_the_popover", () => {
    renderChip({ taskId: "task-1", taskTitle: "Task 1", estimates: [], loading: true });

    const button = screen.getByRole("button", { name: "Estimate for Task 1" });
    fireEvent.click(button);

    // The popover's Save button (rendered by DisciplineEstimatePopover)
    // must never mount while the chip is loading -- that's the only way a
    // stray click can't reach the destructive save path.
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("test_F084_chip_is_interactive_once_loading_resolves", () => {
    renderChip({ taskId: "task-1", taskTitle: "Task 1", estimates: [], loading: false });

    const button = screen.getByRole("button", { name: "Estimate for Task 1" });
    expect(button).not.toBeDisabled();

    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});
