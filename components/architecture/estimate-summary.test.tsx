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
    description: null,
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
      estimatedBy: null,
    })),
    meta: null,
  });
  return details;
}

describe("EstimateSummary (AS-065, AS-066, AS-067)", () => {
  it("test_AS_065_renders_all_five_discipline_columns_without_widening_beyond_a_narrow_viewport", () => {
    // Simulate a 375px viewport: the outer wrapper must not itself declare a
    // fixed/min width wider than the viewport -- overflow, if any, has to
    // live in the inner scroll container (asserted separately below), never
    // on the page body.
    document.documentElement.style.width = "375px";

    render(<EstimateSummary pages={[makePage("page-1", "Home")]} detailsData={makeDetails()} />);

    const table = screen.getByRole("table");
    const headerCells = screen.getAllByRole("columnheader");
    // Page + 5 disciplines + Total = 7 header cells.
    expect(headerCells).toHaveLength(WORK_CATEGORIES.length + 2);
    expect(table.className).not.toMatch(/\bw-\[\d+px\]/);

    document.documentElement.style.width = "";
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

  it("test_AS_065_site_total_row_shows_all_five_active_disciplines", () => {
    render(<EstimateSummary pages={[makePage("page-1", "Home")]} detailsData={makeDetails()} />);

    const headerCells = screen.getAllByRole("columnheader").map(h => h.textContent);
    expect(headerCells).toEqual(
      expect.arrayContaining(["Design", "Dev", "Content/SEO", "PM", "QA"]),
    );
  });
});
