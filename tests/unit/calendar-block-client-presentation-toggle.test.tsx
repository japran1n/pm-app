// @vitest-environment jsdom
//
// Client Presentation toggle on the calendar block form -- checking the
// box sets blockType to "client_presentation" (submitted to the create/
// update Server Action) and switches the color swatch to the alarming red
// default, without clobbering a color the member already picked.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { CalendarBlockPopoverForm } from "@/components/calendar/calendar-block-popover-form";
import { CLIENT_PRESENTATION_DEFAULT_COLOR } from "@/lib/calendar/block-colors";

afterEach(cleanup);

describe("Calendar block client presentation toggle", () => {
  it("test_a_new_block_defaults_to_general_block_type", () => {
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
      expect.objectContaining({ blockType: "general" }),
    );
  });

  it("test_checking_the_client_presentation_toggle_submits_client_presentation_block_type", () => {
    const onSubmit = vi.fn();
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Client call", startTime: "14:00", endTime: "15:00" }}
        submitLabel="Save"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId("calendar-block-client-presentation-toggle"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ blockType: "client_presentation" }),
    );
  });

  it("test_checking_the_toggle_switches_the_default_color_to_the_alarming_red", () => {
    const onSubmit = vi.fn();
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Client call", startTime: "14:00", endTime: "15:00" }}
        submitLabel="Save"
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByTestId("calendar-block-client-presentation-toggle"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ color: CLIENT_PRESENTATION_DEFAULT_COLOR }),
    );
  });

  it("test_checking_the_toggle_does_not_override_a_color_already_deliberately_chosen", () => {
    const onSubmit = vi.fn();
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Client call", startTime: "14:00", endTime: "15:00" }}
        submitLabel="Save"
        onSubmit={onSubmit}
      />,
    );

    // Pick Green first (a deliberate non-default choice).
    fireEvent.click(screen.getByTestId("calendar-block-color-22c55e"));
    fireEvent.click(screen.getByTestId("calendar-block-client-presentation-toggle"));
    fireEvent.click(screen.getByText("Save"));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ color: "#22c55e" }));
  });

  it("test_editing_an_existing_client_presentation_block_shows_the_toggle_already_checked", () => {
    render(
      <CalendarBlockPopoverForm
        initial={{
          title: "Client call",
          startTime: "14:00",
          endTime: "15:00",
          blockType: "client_presentation",
        }}
        submitLabel="Save"
        onSubmit={() => {}}
      />,
    );

    expect(
      screen.getByTestId("calendar-block-client-presentation-toggle"),
    ).toBeChecked();
  });
});
