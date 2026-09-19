// @vitest-environment jsdom
//
// Mission 20260919-150607, F018 (AS-070, AS-071, AS-072): each discipline
// row in the estimate popover carries an inline text input for a note
// stored alongside that discipline's estimate.
//
// AS-070: Popover nudi polje za `note` po disciplini.
// AS-071: Upisana bilješka čita se natrag poslije osvježavanja.
// AS-072: Bilješka je opcionalna -- prazna procjena se čuva bez nje.
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

afterEach(() => {
  cleanup();
});

describe("DisciplineEstimatePopover note field (AS-070, AS-071, AS-072)", () => {
  it("test_AS_070_renders_a_note_input_for_every_discipline_row", () => {
    render(
      <DisciplineEstimatePopover taskId="task-1" taskTitle="Task 1" estimates={[]} />,
    );

    const noteInputs = screen.getAllByPlaceholderText("Note (optional)");
    expect(noteInputs).toHaveLength(WORK_CATEGORIES.length);
  });

  it("test_AS_071_a_previously_saved_note_reads_back_into_its_discipline_row", () => {
    render(
      <DisciplineEstimatePopover
        taskId="task-1"
        taskTitle="Task 1"
        estimates={[
          { discipline: "design", minutes: 60, note: "Needs a moodboard first", estimatedBy: null },
        ]}
      />,
    );

    const designNote = screen.getByLabelText("Design note") as HTMLInputElement;
    expect(designNote.value).toBe("Needs a moodboard first");

    // Other disciplines have no saved note -- their inputs stay empty
    // rather than inheriting design's value.
    const devNote = screen.getByLabelText("Development note") as HTMLInputElement;
    expect(devNote.value).toBe("");
  });

  it("test_AS_072_an_estimate_saves_with_no_note_when_the_note_field_is_left_blank", async () => {
    const mockedBulk = vi.mocked(setDisciplineEstimatesBulk);
    mockedBulk.mockReset();
    mockedBulk.mockResolvedValue({ success: true } as never);

    render(
      <DisciplineEstimatePopover taskId="task-1" taskTitle="Task 1" estimates={[]} />,
    );

    // Only fill the estimate value for "design"; leave its note blank.
    const estimateInputs = screen.getAllByPlaceholderText("—");
    fireEvent.change(estimateInputs[0], { target: { value: "1h" } });

    const saveButton = screen.getByRole("button", { name: "Save" });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockedBulk).toHaveBeenCalled();
    });

    // The single bulk call's "design" entry has an undefined/omitted note
    // -- the estimate persists even though no note was ever typed.
    const [, entries] = mockedBulk.mock.calls[0] as [
      string,
      Array<{ discipline: string; input: string; note?: string }>,
    ];
    const designEntry = entries.find((e) => e.discipline === "design");
    expect(designEntry).toEqual({ discipline: "design", input: "1h", note: undefined });
  });
});
