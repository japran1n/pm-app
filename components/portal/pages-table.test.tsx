// @vitest-environment jsdom
//
// F005 (missions/20260903-portal, AS-016, AS-018): <PagesTable>'s own
// definition of done:
//   - primary success: page name + mono slug, status pill, who has it
//     (avatar + name + role), and updated date all render from the typed
//     `pages` prop.
//   - AS-018: choosing a status in the filter leaves only matching rows,
//     with NO network request (the filter is pure client-side state).
//   - AS-016: the status pill's tooltip content is the database-sourced
//     description, reachable by focusing the pill (mirrors
//     status-pill.test.tsx's own focus-not-hover convention).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { PagesTable } from "@/components/portal/pages-table";
import type { PortalPage } from "@/lib/queries/portal";

afterEach(() => {
  cleanup();
});

const PAGES: PortalPage[] = [
  {
    id: "task-1",
    title: "Homepage",
    slug: "home",
    order: 1,
    status: {
      id: "status-1",
      name: "Awaiting Client Feedback",
      category: "in_progress",
      clientBucket: "waiting",
      clientDescription: "Review the latest draft and leave feedback.",
    },
    assignee: {
      id: "user-1",
      name: "Ana Petrović",
      avatarUrl: null,
      roleLabel: "Member",
    },
    updatedAt: "2026-09-01T10:00:00.000Z",
  },
  {
    id: "task-2",
    title: "Contact",
    slug: "contact",
    order: 2,
    status: {
      id: "status-2",
      name: "QA by Design",
      category: "in_progress",
      clientBucket: "progress",
      clientDescription: null,
    },
    assignee: null,
    updatedAt: "2026-09-02T10:00:00.000Z",
  },
];

describe("PagesTable", () => {
  it("test_AS_016_renders_page_name_slug_status_pill_assignee_and_updated_date", () => {
    render(<PagesTable pages={PAGES} />);

    expect(screen.getByText("Homepage")).toBeInTheDocument();
    expect(screen.getByText("/home")).toBeInTheDocument();
    expect(screen.getByText("Awaiting Client Feedback")).toBeInTheDocument();
    expect(screen.getByText("Ana Petrović")).toBeInTheDocument();
    expect(screen.getByText("Member")).toBeInTheDocument();

    expect(screen.getByText("Contact")).toBeInTheDocument();
    expect(screen.getByText("/contact")).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("test_AS_018_filtering_by_status_hides_non_matching_rows_without_a_network_request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<PagesTable pages={PAGES} />);

    expect(screen.getByText("Homepage")).toBeInTheDocument();
    expect(screen.getByText("Contact")).toBeInTheDocument();

    const filterTrigger = screen.getByLabelText("Filter by status");
    fireEvent.click(filterTrigger);
    const option = screen.getByRole("option", { name: "Waiting on you" });
    // base-ui's Select only commits a click-driven selection when the
    // click was preceded by a real pointerdown on the same item (guards
    // against a stray click landing on an item positioned under the
    // cursor when the popup opens) — see @base-ui/react/select/item's
    // `allowMouseSelectionRef` gate.
    fireEvent.pointerDown(option);
    fireEvent.click(option);

    expect(screen.getByText("Homepage")).toBeInTheDocument();
    expect(screen.queryByText("Contact")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("test_AS_016_status_pill_tooltip_shows_the_database_client_description", () => {
    render(<PagesTable pages={PAGES} />);

    const trigger = screen.getByRole("button", { name: /Awaiting Client Feedback/ });
    fireEvent.focus(trigger);

    expect(
      screen.getByText("Review the latest draft and leave feedback."),
    ).toBeInTheDocument();
  });

  it("shows the pages-view empty state copy when a filter matches nothing", () => {
    render(<PagesTable pages={[]} />);
    expect(screen.getByTestId("pages-table-empty")).toBeInTheDocument();
  });

  // F006g (missions/20260903-portal): a page task with no status at all
  // (`getPortalPages` passes `id`/`name`: null for that row) used to
  // still render a coloured pill with an empty label -- proved here
  // through the real production consumer, not just <StatusPill> in
  // isolation.
  it("test_a_page_with_no_status_renders_a_neutral_no_status_pill", () => {
    const pageWithNoStatus: PortalPage = {
      id: "task-3",
      title: "Pricing",
      slug: "pricing",
      order: 3,
      status: {
        id: null,
        name: null,
        category: "not_started",
        clientBucket: "progress",
        clientDescription: null,
      },
      assignee: null,
      updatedAt: "2026-09-03T10:00:00.000Z",
    };

    render(<PagesTable pages={[...PAGES, pageWithNoStatus]} />);

    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText("No status")).toBeInTheDocument();
  });
});
