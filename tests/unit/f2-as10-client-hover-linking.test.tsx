// @vitest-environment jsdom
//
// 20260915-status-sitemap-audit, F2 (AS-10): hovering one instance of a
// shared component in the portal Site map highlights every other instance
// currently on screen, mirroring the workspace board's hover-linking
// (F033, tests/unit/f033-hover-highlighting.test.tsx). This reuses
// `lib/architecture/use-component-hover.ts` and the `data-component`/
// `data-hover-component` convention as-is -- these tests exercise the DOM
// attributes the hook writes, same as the workspace test does, since the
// actual highlight is CSS-driven (app/globals.css), not React state.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ClientArchitectureBoard } from "@/components/architecture/client-board";
import { ClientSitemapTree } from "@/components/architecture/client-sitemap-tree";
import type { BoardComponent, BoardPage } from "@/lib/queries/architecture";

afterEach(() => {
  cleanup();
});

const componentA: BoardComponent = {
  id: "comp-a",
  name: "Navbar",
  position: 0,
  instanceCount: 2,
};

function makePages(): BoardPage[] {
  return [
    {
      id: "page-1",
      title: "Home",
      pageSlug: "home",
      pageKind: "static",
      position: 0,
      sections: [
        { id: "section-1", title: "Nav 1", position: 0, kind: "static", component: componentA },
        { id: "section-2", title: "Plain", position: 1, kind: "static", component: null },
      ],
    },
    {
      id: "page-2",
      title: "About",
      pageSlug: "about",
      pageKind: "static",
      position: 1,
      sections: [{ id: "section-3", title: "Nav 2", position: 0, kind: "static", component: componentA }],
    },
  ];
}

describe("F2 / AS-10: hover-linking on the portal's flat column view", () => {
  it("hovering one instance of a shared component marks every other instance active", () => {
    render(<ClientArchitectureBoard pages={makePages()} components={[componentA]} />);

    const nav1 = screen.getByTestId("client-section-card-section-1");
    fireEvent.mouseOver(nav1);

    const nav2 = screen.getByTestId("client-section-card-section-3");
    expect(nav1).toHaveAttribute("data-component-active", "true");
    expect(nav2).toHaveAttribute("data-component-active", "true");
  });

  it("hovering an unlinked section activates nothing", () => {
    render(<ClientArchitectureBoard pages={makePages()} components={[componentA]} />);

    const plain = screen.getByTestId("client-section-card-section-2");
    fireEvent.mouseOver(plain);

    const nav1 = screen.getByTestId("client-section-card-section-1");
    const nav2 = screen.getByTestId("client-section-card-section-3");
    expect(nav1).not.toHaveAttribute("data-component-active");
    expect(nav2).not.toHaveAttribute("data-component-active");
  });
});

describe("F2 / AS-10: hover-linking on the portal's tree view", () => {
  it("hovering one instance of a shared component marks every other instance active", () => {
    render(<ClientSitemapTree pages={makePages()} />);

    const nav1 = screen.getByTestId("sitemap-section-section-1");
    fireEvent.mouseOver(nav1);

    const nav2 = screen.getByTestId("sitemap-section-section-3");
    expect(nav1).toHaveAttribute("data-component-active", "true");
    expect(nav2).toHaveAttribute("data-component-active", "true");
  });
});
