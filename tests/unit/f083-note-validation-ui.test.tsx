// F083 (missions/20260919-150607): AS-073 requires the 200-character note
// limit error to be user-visible AND tested. Before this file, nothing
// rendered the popover, typed a >200-char note, clicked Save, and asserted
// the error text appears -- so deleting the error-rendering block in
// discipline-estimate-popover.tsx (`{errors[d] && ...}`) never failed a
// test. This test closes that gap.
//
// It also guards the fix that derives the client-side message from
// `disciplineEstimateNoteSchema` (lib/validation/architecture.ts) instead of
// a hand-duplicated string in the component, so the two can never drift.

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DisciplineEstimatePopover } from "@/components/architecture/discipline-estimate-popover";
import { NOTE_MAX_LENGTH } from "@/lib/validation/architecture";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const setDisciplineEstimatesBulk = vi.fn();
vi.mock("@/lib/actions/architecture", () => ({
  setDisciplineEstimatesBulk: (...args: unknown[]) =>
    setDisciplineEstimatesBulk(...args),
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn() },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("F083 — 200-character note limit error is user-visible (AS-073)", () => {
  it("test_AS_073_a_201_character_note_renders_a_visible_over_limit_error_and_blocks_save", () => {
    render(
      <DisciplineEstimatePopover
        taskId="task-1"
        taskTitle="Task 1"
        estimates={[]}
      />,
    );

    const noteInput = screen.getByLabelText("Design note");
    const overLongNote = "a".repeat(NOTE_MAX_LENGTH + 1);
    fireEvent.change(noteInput, { target: { value: overLongNote } });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // The error text is derived from disciplineEstimateNoteSchema, which
    // reports exactly how many characters over the limit the input is.
    const expectedMessage = `Note is 1 character over the ${NOTE_MAX_LENGTH}-character limit.`;
    expect(screen.getByText(expectedMessage)).toBeInTheDocument();

    // The over-limit note must block the save call entirely.
    expect(setDisciplineEstimatesBulk).not.toHaveBeenCalled();
  });
});
