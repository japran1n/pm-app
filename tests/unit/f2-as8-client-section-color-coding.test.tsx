// @vitest-environment jsdom
//
// 20260915-status-sitemap-audit, F2 (AS-8): the portal Site map applies the
// same CMS/component-linked visual color coding on section cards that
// `section-card.tsx` uses on the workspace board -- CMS sections tinted
// lilac (`border-cms-border`/`bg-cms/*`), component-linked sections tinted
// green (`border-component-border`/`bg-component/*`), CMS winning when a
// section is both. Both `client-page-column.tsx` (flat view) and
// `client-sitemap-tree.tsx` (tree view, AS-7) share the exact classnames
// via `lib/architecture/section-tint.ts` rather than a second, driftable
// copy.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ClientPageColumn } from "@/components/architecture/client-page-column";
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
    description: null,
    sections: [],
    ...overrides,
  };
}

describe("F2 / AS-8: color coding on the portal's flat column cards", () => {
  it("tints a CMS-driven section card with the CMS lilac classes", () => {
    const page = makePage({
      sections: [{ id: "s-cms", title: "Blog list", position: 0, kind: "cms" as const, component: null }],
    });

    render(<ClientPageColumn page={page} />);

    const card = screen.getByTestId("client-section-card-s-cms");
    expect(card.className).toContain("border-cms-border");
    expect(card.className).toContain("hover:bg-cms/10");
  });

  it("tints a component-linked section card with the component green classes", () => {
    const page = makePage({
      sections: [
        {
          id: "s-comp",
          title: "Pricing tiers",
          position: 0,
          kind: "static" as const,
          component: { id: "comp-1", name: "PricingCard" },
        },
      ],
    });

    render(<ClientPageColumn page={page} />);

    const card = screen.getByTestId("client-section-card-s-comp");
    expect(card.className).toContain("border-component-border");
    expect(card.className).toContain("hover:bg-component/10");
  });

  it("CMS wins over component tint when a section is both", () => {
    const page = makePage({
      sections: [
        {
          id: "s-both",
          title: "CMS-driven component",
          position: 0,
          kind: "cms" as const,
          component: { id: "comp-1", name: "PricingCard" },
        },
      ],
    });

    render(<ClientPageColumn page={page} />);

    const card = screen.getByTestId("client-section-card-s-both");
    expect(card.className).toContain("border-cms-border");
    expect(card.className).not.toContain("border-component-border");
  });

  it("a plain static section with no component gets no tint classes", () => {
    const page = makePage({
      sections: [{ id: "s-plain", title: "Hero", position: 0, kind: "static" as const, component: null }],
    });

    render(<ClientPageColumn page={page} />);

    const card = screen.getByTestId("client-section-card-s-plain");
    expect(card.className).not.toContain("border-cms-border");
    expect(card.className).not.toContain("border-component-border");
  });
});

describe("F2 / AS-8: color coding on the portal's tree view section cards", () => {
  it("tints a CMS-driven section card in the tree view identically", () => {
    const pages: BoardPage[] = [
      makePage({
        sections: [{ id: "s-cms-tree", title: "Blog list", position: 0, kind: "cms" as const, component: null }],
      }),
    ];

    render(<ClientSitemapTree pages={pages} />);

    const card = screen.getByTestId("sitemap-section-s-cms-tree");
    expect(card.className).toContain("border-cms-border");
  });

  it("tints a folder node with the amber-dashed folder classes", () => {
    const pages: BoardPage[] = [
      makePage({ id: "page-privacy", title: "Privacy", pageSlug: "legal/privacy", position: 0 }),
    ];

    render(<ClientSitemapTree pages={pages} />);

    const folder = screen.getByTestId("sitemap-folder-legal");
    expect(folder.className).toContain("border-dashed");
    expect(folder.className).toContain("border-folder-border");
  });
});
