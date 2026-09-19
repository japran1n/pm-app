// @vitest-environment jsdom
//
// 20260915-status-sitemap-audit, F2 (AS-7): the portal Site map's read-only
// nested/tree view of the page hierarchy, built from
// `lib/architecture/page-tree.ts`'s `buildPageTree` -- the same function
// `canvas-board.tsx` uses on the workspace side, so "what counts as a
// folder" never has two answers.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ClientSitemapTree } from "@/components/architecture/client-sitemap-tree";
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
    sections: [],
    ...overrides,
  };
}

describe("F2 / AS-7: client sitemap tree view", () => {
  it("renders a nested hierarchy reflecting real page slug structure -- a child page nests under its parent", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-home", title: "Home", pageSlug: "home", position: 0 }),
      makePage({ id: "page-services", title: "Services", pageSlug: "services", position: 1 }),
      makePage({ id: "page-seo", title: "SEO", pageSlug: "services/seo", position: 0 }),
    ];

    render(<ClientSitemapTree pages={pages} />);

    expect(screen.getByTestId("sitemap-page-page-home")).toBeInTheDocument();
    expect(screen.getByTestId("sitemap-page-page-services")).toBeInTheDocument();
    expect(screen.getByTestId("sitemap-page-page-seo")).toBeInTheDocument();

    // The child page's node is nested inside the parent's own subtree list,
    // not merely present anywhere on the page -- this is the actual
    // "nested" claim AS-7 makes, not just "shows every page in a flat list
    // with different CSS."
    const servicesNode = screen.getByTestId("sitemap-page-page-services");
    const servicesBranch = servicesNode.closest("li");
    expect(servicesBranch?.querySelector('[data-testid="sitemap-page-page-seo"]')).not.toBeNull();
  });

  it("synthesises a folder node for a path segment with no page of its own", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-home", title: "Home", pageSlug: "home", position: 0 }),
      // "legal" segment has no page of its own -- only its children do.
      makePage({ id: "page-privacy", title: "Privacy", pageSlug: "legal/privacy", position: 0 }),
      makePage({ id: "page-terms", title: "Terms", pageSlug: "legal/terms", position: 1 }),
    ];

    render(<ClientSitemapTree pages={pages} />);

    expect(screen.getByTestId("sitemap-folder-legal")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
    expect(screen.getByTestId("sitemap-page-page-privacy")).toBeInTheDocument();
    expect(screen.getByTestId("sitemap-page-page-terms")).toBeInTheDocument();
  });

  it("never derives a folder label from a page the client cannot see -- only from the already-filtered pages it's handed", () => {
    // Simulates what getArchitectureBoardForClient would hand this
    // component: a hidden sibling page ("internal-tools") is simply never
    // in the array at all. The folder segment name itself ("workspace")
    // comes only from a page this client can already see
    // ("workspace/dashboard"), never from any hidden page's own title or
    // description -- there is no hidden row here for a label to leak from.
    const pages: BoardPage[] = [
      makePage({ id: "page-dashboard", title: "Dashboard", pageSlug: "workspace/dashboard", position: 0 }),
    ];

    render(<ClientSitemapTree pages={pages} />);

    expect(screen.getByTestId("sitemap-folder-workspace")).toBeInTheDocument();
    expect(screen.queryByText(/internal.?tools/i)).toBeNull();
  });

  it("renders no editing affordances -- no buttons, no inputs, purely a browse view", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-home",
        title: "Home",
        pageSlug: "home",
        sections: [{ id: "section-1", title: "Hero", position: 0, kind: "static" as const, component: null }],
      }),
    ];

    render(<ClientSitemapTree pages={pages} />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText(/create page here/i)).toBeNull();
    expect(screen.queryByLabelText(/delete/i)).toBeNull();
  });
});
