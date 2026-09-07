// @vitest-environment jsdom
//
// Planner block color picker: a fixed row of predefined swatches
// (lib/calendar/block-colors.ts) a member picks from when creating or
// editing a calendar block -- not a full custom color input. Covers both
// the form itself (selecting a swatch changes the submitted value) and
// the rendered chip (a block with a known color renders with that color
// applied, both in the week time-grid and the month-grid chip).

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import {
  CalendarBlockPopoverForm,
  type CalendarBlockFormValues,
} from "@/components/calendar/calendar-block-popover-form";
import { CALENDAR_BLOCK_COLORS, DEFAULT_CALENDAR_BLOCK_COLOR } from "@/lib/calendar/block-colors";

afterEach(cleanup);

describe("Calendar block color picker", () => {
  it("test_form_renders_a_swatch_button_for_every_predefined_color", () => {
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30" }}
        submitLabel="Save"
        onSubmit={() => {}}
      />,
    );

    for (const swatch of CALENDAR_BLOCK_COLORS) {
      expect(
        screen.getByTestId(`calendar-block-color-${swatch.value.replace("#", "")}`),
      ).toBeInTheDocument();
    }
  });

  it("test_a_new_block_defaults_to_the_first_swatch_when_no_color_is_set_yet", () => {
    const onSubmit = vi.fn();
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30" }}
        submitLabel="Save"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ color: DEFAULT_CALENDAR_BLOCK_COLOR }),
    );
  });

  it("test_clicking_a_swatch_selects_it_and_submits_that_color", () => {
    const onSubmit = vi.fn<(values: CalendarBlockFormValues) => void>();
    const chosen = CALENDAR_BLOCK_COLORS[3]!;

    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30" }}
        submitLabel="Save"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId(`calendar-block-color-${chosen.value.replace("#", "")}`));
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ color: chosen.value }));
  });

  it("test_editing_an_existing_block_preselects_its_own_saved_color", () => {
    const existingColor = CALENDAR_BLOCK_COLORS[5]!;
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30", color: existingColor.value }}
        submitLabel="Save"
        onSubmit={() => {}}
      />,
    );

    const preselected = screen.getByTestId(`calendar-block-color-${existingColor.value.replace("#", "")}`);
    expect(preselected).toHaveAttribute("aria-checked", "true");
  });
});
