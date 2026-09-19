// @vitest-environment jsdom
//
// Mission 20260919-150607, F008 (AS-033): the client-facing board
// (`client-page-column.tsx`) must show the same CMS tint the main
// architecture board applies via `sectionKindAccentClassName` /
// `sectionKindStaticTintClassName` (lib/architecture/section-tint.ts) when
// a section's `kind === "cms"`. This was already wired up by an earlier
// mission (20260915-status-sitemap-audit, F2/AS-8); this test pins the
// AS-033 assertion text directly so a future regression in either the
// client board or the shared tint helper is caught under this feature's ID.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ClientPageColumn } from "@/components/architecture/client-page-column";
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

describe("AS-033: client board section cards show CMS tint when section.kind === 'cms'", () => {
  it("applies the CMS lilac tint classes to a CMS section card on the client board", () => {
    const page = makePage({
      sections: [{ id: "s-cms", title: "Blog list", position: 0, kind: "cms" as const, component: null }],
    });

    render(<ClientPageColumn page={page} />);

    const card = screen.getByTestId("client-section-card-s-cms");
    expect(card.className).toContain("border-cms-border");
    expect(card.className).toContain("bg-cms/5");
  });

  it("does not apply the CMS tint to a non-CMS section card on the client board", () => {
    const page = makePage({
      sections: [{ id: "s-static", title: "Hero", position: 0, kind: "static" as const, component: null }],
    });

    render(<ClientPageColumn page={page} />);

    const card = screen.getByTestId("client-section-card-s-static");
    expect(card.className).not.toContain("border-cms-border");
    expect(card.className).not.toContain("bg-cms/5");
  });
});
