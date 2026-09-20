// @vitest-environment jsdom
//
// F023 (AS-044/AS-045): the calendar block popover shows an editable form
// (with Save + Delete) for the signed-in member's own block, but a
// read-only detail view (no Save button, no Delete button) for a block
// owned by another member.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { CalendarBlockPopoverForm } from "@/components/calendar/calendar-block-popover-form";

afterEach(cleanup);

describe("F023: read-only popover for another member's block", () => {
  it("test_AS_044_isOwn_true_renders_save_and_delete_buttons", () => {
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30" }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
        isOwn
      />,
    );

    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("test_AS_045_isOwn_false_hides_save_and_delete_buttons", () => {
    render(
      <CalendarBlockPopoverForm
        initial={{ title: "Standup", startTime: "09:00", endTime: "09:30" }}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
        isOwn={false}
      />,
    );

    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    // Still shows the block's details, just read-only.
    expect(screen.getByDisplayValue("Standup")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Standup")).toBeDisabled();
    expect(screen.getByTestId("calendar-block-readonly-note")).toBeInTheDocument();
  });
});
