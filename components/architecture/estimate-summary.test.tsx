// @vitest-environment jsdom
//
// Mission 20260919-150607, F016 (AS-065, AS-066, AS-067): the estimate
// summary table must render all five discipline columns (design,
// development, content_seo, pm, qa -- introduced by F011) without forcing
// the page's body element to scroll horizontally on narrow viewports; any
// overflow must be contained in the table's own scroll container, and the
// numeric cells must keep using font-mono + tabular-nums.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails } from "@/lib/architecture/types";
import { WORK_CATEGORIES } from "@/lib/architecture/types";
import { EstimateSummary } from "./estimate-summary";

afterEach(() => {
  cleanup();
});

function makePage(id: string, title: string): BoardPage {
  return {
    id,
    title,
    pageSlug: id,
    pageKind: null,
    position: 0,
    sections: [],
  };
}

function makeDetails(): ArchitectureNodeDetails {
  const details: ArchitectureNodeDetails = new Map();
  details.set("page-1", {
    estimates: WORK_CATEGORIES.map(discipline => ({
      discipline,
      minutes: 60,
      note: null,
    })),
    meta: null,
  });
  return details;
}

describe("EstimateSummary (AS-065, AS-066, AS-067)", () => {
  it("test_AS_065_renders_visible_discipline_columns_without_widening_beyond_a_narrow_viewport", () => {
    // jsdom has no layout engine, so we cannot assert actual pixel widths or
    // that body scroll doesn't occur. Instead we assert the DOM structure
    // that is *responsible* for that behaviour: a scroll container with
    // `overflow-x-auto` wraps a table that is allowed to grow past its
    // container (`min-w-max`). The UI only surfaces design + development
    // columns (content_seo/pm/qa remain valid disciplines in the DB but are
    // hidden here). If `overflow-x-auto` is removed from the component,
    // this test fails.
    render(<EstimateSummary pages={[makePage("page-1", "Home")]} detailsData={makeDetails()} />);

    const table = screen.getByRole("table");
    const headerCells = screen.getAllByRole("columnheader");
    // Page + 2 visible disciplines + Total = 4 header cells.
    expect(headerCells).toHaveLength(4);

    const scrollContainer = table.parentElement;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer!.className).toContain("overflow-x-auto");
    expect(table.className).toContain("min-w-max");

    const headerText = headerCells.map(h => h.textContent);
    expect(headerText).toEqual(expect.arrayContaining(["Design", "Dev"]));
    expect(headerText).not.toEqual(
      expect.arrayContaining(["Content/SEO", "PM", "QA"]),
    );
  });

  it("test_AS_066_table_scrolls_within_its_own_overflow_x_container_when_it_does_not_fit", () => {
    render(<EstimateSummary pages={[makePage("page-1", "Home")]} detailsData={makeDetails()} />);

    const table = screen.getByRole("table");
    const scrollContainer = table.parentElement;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer!.className).toContain("overflow-x-auto");
  });

  it("test_AS_067_numeric_cells_keep_font_mono_and_tabular_nums", () => {
    render(<EstimateSummary pages={[makePage("page-1", "Home")]} detailsData={makeDetails()} />);

    const cells = screen.getAllByRole("cell");
    // Every discipline + total cell (all but the "Page" title cell) is numeric.
    const numericCells = cells.filter(c => c.textContent !== "Home");
    expect(numericCells.length).toBeGreaterThan(0);
    for (const cell of numericCells) {
      expect(cell.className).toContain("font-mono");
      expect(cell.className).toContain("tabular-nums");
    }
  });

  it("test_AS_065_no_hardcoded_hex_colors_in_inline_styles", () => {
    const { container } = render(
      <EstimateSummary pages={[makePage("page-1", "Home")]} detailsData={makeDetails()} />,
    );

    const elementsWithStyle = container.querySelectorAll("[style]");
    for (const el of Array.from(elementsWithStyle)) {
      const styleAttr = el.getAttribute("style") ?? "";
      expect(styleAttr).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});
