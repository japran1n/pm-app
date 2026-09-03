// @vitest-environment jsdom
//
// F006 (missions/20260903-portal, AS-031): the overview's risk banner.
// This feature's own explicit instruction: "it must not render a
// placeholder" -- until F012/F014 wire it, it must render literally
// nothing, not an empty card or a "no risks" message.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { RiskBanner } from "@/components/portal/risk-banner";

afterEach(() => {
  cleanup();
});

describe("RiskBanner", () => {
  it("test_AS_031_renders_nothing_when_there_is_nothing_to_warn_about", () => {
    const { container } = render(<RiskBanner risks={[]} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("test_AS_031_renders_a_blocking_overdue_deliverable_once_it_is_wired", () => {
    render(
      <RiskBanner
        risks={[
          {
            id: "r1",
            message: "Content for the Services page is 6 days late. Launch on Nov 15 is at risk.",
          },
        ]}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Content for the Services page is 6 days late.");
  });
});
