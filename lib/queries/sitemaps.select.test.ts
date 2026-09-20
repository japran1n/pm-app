// Standalone Sitemap tool, Phase 1: unit coverage for
// buildSitemapBoardFromRows (lib/queries/sitemaps.ts), mirroring
// lib/queries/architecture.select.test.ts's file-per-module convention
// but exercising the actual row-shaping logic with fixture rows (no DB
// round trip) -- proving the function returns the exact
// `ArchitectureBoard` shape (`{ pages, components }`) the existing
// canvas already renders, so a standalone sitemap is a drop-in.

import { describe, expect, it } from "vitest";
import { buildSitemapBoardFromRows } from "@/lib/queries/sitemaps";

describe("buildSitemapBoardFromRows", () => {
  it("returns an empty board for a sitemap with no pages or components", () => {
    const board = buildSitemapBoardFromRows([], [], []);
    expect(board).toEqual({ pages: [], components: [] });
  });

  it("orders pages by position, not by insertion order", () => {
    const board = buildSitemapBoardFromRows(
      [
        { id: "p2", title: "About", slug: "about", kind: "static", position: 1 },
        { id: "p1", title: "Home", slug: "home", kind: "static", position: 0 },
      ],
      [],
      [],
    );

    expect(board.pages.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("nests each page's sections, ordered by position, under that page only", () => {
    const board = buildSitemapBoardFromRows(
      [
        { id: "p1", title: "Home", slug: "home", kind: "static", position: 0 },
        { id: "p2", title: "About", slug: "about", kind: "static", position: 1 },
      ],
      [
        { id: "s2", page_id: "p1", title: "Footer", kind: "static", component_id: null, position: 1 },
        { id: "s1", page_id: "p1", title: "Hero", kind: "static", component_id: null, position: 0 },
        { id: "s3", page_id: "p2", title: "Team", kind: "static", component_id: null, position: 0 },
      ],
      [],
    );

    expect(board.pages[0]?.sections.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(board.pages[1]?.sections.map((s) => s.id)).toEqual(["s3"]);
  });

  it("maps section.kind !== 'cms' to 'static', matching architecture.ts's own coercion", () => {
    const board = buildSitemapBoardFromRows(
      [{ id: "p1", title: "Home", slug: "home", kind: "static", position: 0 }],
      [
        { id: "s1", page_id: "p1", title: "Hero", kind: "cms", component_id: null, position: 0 },
        { id: "s2", page_id: "p1", title: "Footer", kind: "anything-else", component_id: null, position: 1 },
      ],
      [],
    );

    expect(board.pages[0]?.sections[0]?.kind).toBe("cms");
    expect(board.pages[0]?.sections[1]?.kind).toBe("static");
  });

  it("attaches the linked component's {id, name} to a section, and null when unlinked", () => {
    const board = buildSitemapBoardFromRows(
      [{ id: "p1", title: "Home", slug: "home", kind: "static", position: 0 }],
      [
        { id: "s1", page_id: "p1", title: "Hero", kind: "static", component_id: "c1", position: 0 },
        { id: "s2", page_id: "p1", title: "Footer", kind: "static", component_id: null, position: 1 },
      ],
      [{ id: "c1", name: "Navbar", position: 0 }],
    );

    expect(board.pages[0]?.sections[0]?.component).toEqual({ id: "c1", name: "Navbar" });
    expect(board.pages[0]?.sections[1]?.component).toBeNull();
  });

  it("computes each component's instanceCount from sections that reference it, defaulting to 0", () => {
    const board = buildSitemapBoardFromRows(
      [
        { id: "p1", title: "Home", slug: "home", kind: "static", position: 0 },
        { id: "p2", title: "About", slug: "about", kind: "static", position: 1 },
      ],
      [
        { id: "s1", page_id: "p1", title: "Hero", kind: "static", component_id: "c1", position: 0 },
        { id: "s2", page_id: "p2", title: "Hero", kind: "static", component_id: "c1", position: 0 },
      ],
      [
        { id: "c1", name: "Navbar", position: 0 },
        { id: "c2", name: "Unused", position: 1 },
      ],
    );

    const navbar = board.components.find((c) => c.id === "c1");
    const unused = board.components.find((c) => c.id === "c2");
    expect(navbar?.instanceCount).toBe(2);
    expect(unused?.instanceCount).toBe(0);
  });

  it("carries pageSlug and pageKind through unchanged, including a null kind", () => {
    const board = buildSitemapBoardFromRows(
      [{ id: "p1", title: "Home", slug: "home", kind: null, position: 0 }],
      [],
      [],
    );

    expect(board.pages[0]).toMatchObject({ pageSlug: "home", pageKind: null });
  });

  it("orders top-level components by position", () => {
    const board = buildSitemapBoardFromRows(
      [],
      [],
      [
        { id: "c2", name: "Footer", position: 1 },
        { id: "c1", name: "Navbar", position: 0 },
      ],
    );

    expect(board.components.map((c) => c.id)).toEqual(["c1", "c2"]);
  });
});
