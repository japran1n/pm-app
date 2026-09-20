// @vitest-environment jsdom
//
// F038 (AS-083): each person's swimlane row in the stacked planner is a
// labelled ARIA region, announced with the person's name.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { StackedPersonRow } from "@/components/calendar/stacked-person-row";

const WEEK_KEY = "2026-09-14";

afterEach(() => {
  cleanup();
});

describe("F038 stacked planner accessibility", () => {
  it("test_AS_083_stacked_row_is_labelled_region", () => {
    render(
      <StackedPersonRow
        userId="user-alice"
        userLabel="Alice"
        blocks={[]}
        weekKey={WEEK_KEY}
      />,
    );

    const region = screen.getByRole("region", { name: /alice/i });
    expect(region).toBeInTheDocument();
  });

  it("test_AS_083_row_label_falls_back_to_userId_without_name", () => {
    render(
      <StackedPersonRow userId="user-bob" blocks={[]} weekKey={WEEK_KEY} />,
    );

    const region = screen.getByRole("region", { name: /user-bob/i });
    expect(region).toBeInTheDocument();
  });
});
