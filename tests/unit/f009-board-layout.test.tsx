// @vitest-environment jsdom
//
// Mission 20260910-182104, F009 (AS-027): the Architecture board scrolls
// horizontally when its columns exceed the viewport width.

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

describe("F009 architecture board horizontal layout", () => {
  it("AS-027: the board container clips overflow and scrolls horizontally", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Home", pageSlug: "home" }),
      makePage({ id: "page-2", title: "Pricing", pageSlug: "pricing" }),
    ];

    const { container } = render(
      <ArchitectureBoard pages={pages} components={[]} />,
    );

    const board = container.querySelector(".overflow-x-auto") as HTMLElement;
    expect(board).not.toBeNull();
    expect(board).toHaveClass("overflow-x-auto");
  });

  it("AS-027: the board row is a non-wrapping flex row so columns line up horizontally", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-1", title: "Home", pageSlug: "home" }),
      makePage({ id: "page-2", title: "Pricing", pageSlug: "pricing" }),
    ];

    const { container } = render(
      <ArchitectureBoard pages={pages} components={[]} />,
    );

    const board = container.querySelector(".overflow-x-auto") as HTMLElement;
    expect(board).not.toBeNull();
    expect(board).toHaveClass("flex");
    expect(board.className).not.toMatch(/flex-wrap\b/);
  });

  it("AS-027: many columns render side by side without a wrapping structure", () => {
    const pages: BoardPage[] = Array.from({ length: 8 }, (_, i) =>
      makePage({
        id: `page-${i}`,
        title: `Page ${i}`,
        pageSlug: `page-${i}`,
      }),
    );

    render(<ArchitectureBoard pages={pages} components={[]} />);

    pages.forEach((page) => {
      expect(screen.getByText(page.title)).toBeInTheDocument();
    });
  });
});
