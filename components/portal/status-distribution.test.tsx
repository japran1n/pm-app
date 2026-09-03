// @vitest-environment jsdom
//
// F005 (missions/20260903-portal, AS-017): the Pages view's distribution
// bar. Covers this feature's own definition of done directly:
//   - primary success: four buckets with real counts render a segment per
//     non-zero bucket AND every bucket's count-as-a-number/name-as-text in
//     the key beneath, regardless of colour.
//   - a zero-count bucket is omitted from the bar but still listed in the
//     key as "0" (this feature's own explicit instruction).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { StatusDistribution } from "@/components/portal/status-distribution";

afterEach(() => {
  cleanup();
});

describe("StatusDistribution", () => {
  it("test_AS_017_renders_every_bucket_count_as_a_number_and_a_name", () => {
    render(
      <StatusDistribution
        counts={{ waiting: 2, progress: 3, blocked: 1, done: 4 }}
      />,
    );

    expect(screen.getByText("Waiting on you")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("Ready to launch")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("test_AS_017_a_bucket_with_zero_pages_is_omitted_from_the_bar_but_still_listed_as_0_in_the_key", () => {
    render(
      <StatusDistribution
        counts={{ waiting: 2, progress: 0, blocked: 0, done: 1 }}
      />,
    );

    // No bar segment drawn for a zero-count bucket.
    expect(
      screen.queryByTestId("status-distribution-segment-progress"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("status-distribution-segment-blocked"),
    ).not.toBeInTheDocument();
    // Segments DO render for the non-zero buckets.
    expect(
      screen.getByTestId("status-distribution-segment-waiting"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("status-distribution-segment-done"),
    ).toBeInTheDocument();

    // But the key beneath still states every bucket, including the two
    // zero-count ones, as an explicit "0" — never a missing row.
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Blocked")).toBeInTheDocument();
    const zeros = screen.getAllByText("0");
    expect(zeros).toHaveLength(2);
  });

  it("test_AS_017_state_is_never_colour_alone_every_key_row_has_both_a_number_and_a_label", () => {
    render(
      <StatusDistribution
        counts={{ waiting: 0, progress: 0, blocked: 0, done: 0 }}
      />,
    );

    const key = screen.getByText("Waiting on you").closest("dl");
    expect(key).not.toBeNull();
    // Every one of the four buckets renders as text, alongside its own
    // numeric count — never a bare coloured dot with no label.
    for (const label of ["Waiting on you", "In progress", "Blocked", "Ready to launch"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("0")).toHaveLength(4);
  });
});
