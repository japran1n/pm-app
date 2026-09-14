// @vitest-environment jsdom
//
// Mission 20260914-portal-simplify, F010 (AS-018): Home's "N things are
// waiting on you" callout.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { WaitingOnYouCallout } from "./waiting-on-you-callout";

afterEach(() => {
  cleanup();
});

describe("WaitingOnYouCallout (AS-018)", () => {
  it("test_AS_018_shows_the_callout_with_plural_count_when_N_greater_than_1", () => {
    render(<WaitingOnYouCallout total={3} overdue={0} href="/portal/acme/p/proj-1/for-you" />);

    const callout = screen.getByTestId("waiting-on-you-callout");
    expect(callout).toBeInTheDocument();
    expect(callout.textContent?.replace(/\s+/g, " ")).toContain("3 things are waiting on you");
  });

  it("test_AS_018_uses_singular_wording_for_exactly_one_thing", () => {
    render(<WaitingOnYouCallout total={1} overdue={0} href="/portal/acme/p/proj-1/for-you" />);

    const callout = screen.getByTestId("waiting-on-you-callout");
    const normalized = callout.textContent?.replace(/\s+/g, " ") ?? "";
    expect(normalized).toContain("1 thing is waiting on you");
    expect(normalized).not.toContain("things are waiting");
  });

  it("test_AS_018_hides_the_callout_entirely_when_total_is_zero", () => {
    const { container } = render(
      <WaitingOnYouCallout total={0} overdue={0} href="/portal/acme/p/proj-1/for-you" />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("waiting-on-you-callout")).not.toBeInTheDocument();
  });

  it("test_AS_018_notes_a_single_overdue_item_in_singular_form", () => {
    render(<WaitingOnYouCallout total={2} overdue={1} href="/portal/acme/p/proj-1/for-you" />);

    expect(screen.getByTestId("waiting-on-you-callout-overdue")).toHaveTextContent(
      "One is overdue.",
    );
  });

  it("test_AS_018_notes_multiple_overdue_items_in_plural_form", () => {
    render(<WaitingOnYouCallout total={3} overdue={2} href="/portal/acme/p/proj-1/for-you" />);

    expect(screen.getByTestId("waiting-on-you-callout-overdue")).toHaveTextContent(
      "2 are overdue.",
    );
  });

  it("test_AS_018_omits_the_overdue_note_when_nothing_is_overdue", () => {
    render(<WaitingOnYouCallout total={2} overdue={0} href="/portal/acme/p/proj-1/for-you" />);

    expect(screen.queryByTestId("waiting-on-you-callout-overdue")).not.toBeInTheDocument();
  });

  it("test_AS_018_the_primary_button_links_to_the_For_you_route_it_was_given", () => {
    render(
      <WaitingOnYouCallout total={4} overdue={0} href="/portal/acme/p/proj-42/for-you" />,
    );

    const link = screen.getByTestId("waiting-on-you-callout-link");
    expect(link).toHaveAttribute("href", "/portal/acme/p/proj-42/for-you");
    expect(link).toHaveTextContent("Review now");
  });

  it("test_AS_018_renders_the_count_in_a_monospace_span", () => {
    render(<WaitingOnYouCallout total={5} overdue={0} href="/portal/acme/p/proj-1/for-you" />);

    const countEl = screen.getByTestId("waiting-on-you-callout-count");
    expect(countEl).toHaveTextContent("5");
    expect(countEl.className).toContain("font-mono");
  });
});
