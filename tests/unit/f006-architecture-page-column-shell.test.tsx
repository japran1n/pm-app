// @vitest-environment jsdom
//
// Mission 20260910-182104, F006 (AS-019, AS-020, AS-021): the Architecture
// board renders one column per page, each column shows the page name, and
// shows the page description only when one is set.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  useParams: () => ({ workspaceSlug: "acme", projectId: "proj-1" }),
}));

import { ArchitectureBoard } from "@/components/architecture/board";
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

describe("F006 architecture board page column shell", () => {
  it("AS-019: renders one column per page", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Home", pageSlug: "home" }),
      makePage({ id: "page-2", title: "Pricing", pageSlug: "pricing" }),
      makePage({ id: "page-3", title: "About", pageSlug: "about" }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("AS-020: a page column shows the page name", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Dashboard", pageSlug: "dashboard" }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  it("AS-021: a page column shows the page description when one is set", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Dashboard",
        pageSlug: "dashboard",
        description: "The signed-in landing page",
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} />);

    expect(
      screen.getByText("The signed-in landing page"),
    ).toBeInTheDocument();
  });

  it("AS-021: a page column shows no description when none is set", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Dashboard",
        pageSlug: "dashboard",
        description: null,
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} />);

    // Only the page name paragraph renders in the header, no second
    // description line.
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText(/./, { selector: "p.text-xs" })).toBeNull();
  });
});
