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
    sections: [],
    clientVisible: false,
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

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Pricing")).toBeInTheDocument();
    expect(screen.getByText("About")).toBeInTheDocument();
  });

  it("AS-020: a page column shows the page name", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Dashboard", pageSlug: "dashboard" }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
  });

  // AS-021 (page description rendering) was retired by mission
  // 20260919-150607 F035 (AS-119, AS-120): `description_text` is no longer
  // loaded or rendered on the architecture board at all, so `BoardPage` no
  // longer carries a `description` field -- see
  // tests/unit/f035-no-description-text-query.test.ts for the current
  // coverage (no SELECT re-adds it, no column ever renders it).
  it("AS-119: a page column never renders a description line, even with matching text elsewhere", () => {
    const pages: BoardPage[] = [
      makePage({
        id: "page-1",
        title: "Dashboard",
        pageSlug: "dashboard",
      }),
    ];

    render(<ArchitectureBoard pages={pages} components={[]} projectId={"00000000-0000-4000-8000-000000000001"} />);

    // Only the page name paragraph renders in the header, no second
    // description line.
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.queryByText(/./, { selector: "p.text-xs.text-muted-foreground" })).toBeNull();
  });
});
