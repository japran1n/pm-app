// @vitest-environment jsdom
//
// Mission 20260910-182104, F037 (AS-091, AS-098): the portal's read-only
// Architecture board -- renders one column per client-visible page and
// section, with no editing affordances rendered at all. Filtering itself
// (AS-098) happens in `getArchitectureBoardForClient`
// (lib/queries/architecture.ts) -- this component receives already-
// filtered pages and just needs to never introduce any edit UI of its
// own for whatever it's handed.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ClientArchitectureBoard } from "@/components/architecture/client-board";
import type { BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

function makePage(overrides: Partial<BoardPage>): BoardPage {
  return {
    id: "page-1",
    title: "Home",
    pageSlug: "home",
    pageKind: "static",
    position: 0,
    description: null,
    sections: [],
    ...overrides,
  };
}

describe("F037 client board view", () => {
  it("AS-091: a client can view the board -- renders a column per page with its sections", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        pageSlug: "home",
        sections: [
          { id: "section-1", title: "Hero", position: 0, component: null },
          {
            id: "section-2",
            title: "Pricing tiers",
            position: 1,
            component: { id: "component-1", name: "PricingCard" },
          },
        ],
      }),
      makePage({ id: "page-2", title: "About", pageSlug: "about" }),
    ];

    render(<ClientArchitectureBoard pages={pages} components={[]} />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
    expect(screen.getByText("Hero")).toBeInTheDocument();
    expect(screen.getByText("Pricing tiers")).toBeInTheDocument();
    expect(screen.getByText("PricingCard")).toBeInTheDocument();
  });

  it("AS-098: a page not returned by the client-filtered query never renders -- board only reflects what it's handed", () => {
    // getArchitectureBoardForClient already excludes non-client-visible
    // pages/sections before this component ever sees them; this asserts
    // the board doesn't independently reintroduce anything not in its
    // `pages` prop.
    const pages: BoardPage[] = [makePage({ id: "page-1", title: "Home" })];

    render(<ClientArchitectureBoard pages={pages} components={[]} />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.queryByText("Internal admin page")).toBeNull();
  });

  it("does not render any editing affordances", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Home",
        sections: [{ id: "section-1", title: "Hero", position: 0, component: null }],
      }),
    ];

    render(<ClientArchitectureBoard pages={pages} components={[]} />);

    // No drag handles, no rename/edit inputs, no add/delete/link buttons.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText(/reorder/i)).toBeNull();
    expect(screen.queryByLabelText(/link component/i)).toBeNull();
    expect(screen.queryByLabelText(/create component/i)).toBeNull();
    expect(screen.queryByText(/add section/i)).toBeNull();
  });

  it("shows a no-sections message for an empty page", () => {
    const pages: BoardPage[] = [makePage({ id: "page-1", title: "Home", sections: [] })];

    render(<ClientArchitectureBoard pages={pages} components={[]} />);

    expect(screen.getByText(/no sections yet/i)).toBeInTheDocument();
  });
});
