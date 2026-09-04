// @vitest-environment jsdom
//
// F006 (missions/20260903-portal, AS-031): the overview's risk banner.
// This feature's own explicit instruction: "it must not render a
// placeholder" -- until F012/F014 wire it, it must render literally
// nothing, not an empty card or a "no risks" message.
//
// F085 (missions/20260903-portal audit, defect 5): a row used to be a
// bare sentence with no item name, no due date and no link. It must now
// name the item, state its due date, and link to where the client acts.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { RiskBanner } from "@/components/portal/risk-banner";

afterEach(() => {
  cleanup();
});

const YOUR_LIST_HREF = "/portal/acme/p/project-1/your-list";

describe("RiskBanner", () => {
  it("test_AS_031_renders_nothing_when_there_is_nothing_to_warn_about", () => {
    const { container } = render(<RiskBanner risks={[]} yourListHref={YOUR_LIST_HREF} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("test_AS_031_renders_a_blocking_overdue_deliverable_once_it_is_wired", () => {
    render(
      <RiskBanner
        risks={[
          {
            id: "r1",
            message: "The Services page cannot be built without its copy, and 15 Nov moves with it.",
            itemName: "Services page copy",
            dueAt: "2026-09-09",
          },
        ]}
        yourListHref={YOUR_LIST_HREF}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(
      "The Services page cannot be built without its copy, and 15 Nov moves with it.",
    );
  });

  // F085 (defect 5): the item name and its due date are the whole point
  // of this fix -- "which item? how late?" answered without leaving the
  // banner.
  it("test_AS_085_names_the_item_and_its_due_date", () => {
    render(
      <RiskBanner
        risks={[
          {
            id: "r1",
            message: "The Services page cannot be built without its copy.",
            itemName: "Services page copy",
            dueAt: "2026-09-09",
          },
        ]}
        yourListHref={YOUR_LIST_HREF}
      />,
    );

    expect(screen.getByText(/Services page copy/)).toBeInTheDocument();
    expect(screen.getByText(/9 Sep/)).toBeInTheDocument();
  });

  // F085 (defect 5): "where do I fix it?" -- the row links to Your list,
  // the one place a client can actually act on an outstanding item.
  it("test_AS_085_links_to_where_the_client_can_act_on_it", () => {
    render(
      <RiskBanner
        risks={[
          {
            id: "r1",
            message: "The Services page cannot be built without its copy.",
            itemName: "Services page copy",
            dueAt: "2026-09-09",
          },
        ]}
        yourListHref={YOUR_LIST_HREF}
      />,
    );

    const link = screen.getByTestId("risk-banner-link");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", YOUR_LIST_HREF);
  });
});
