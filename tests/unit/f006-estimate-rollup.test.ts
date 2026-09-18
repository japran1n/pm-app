// F06 (missions/20260918-architecture-enrichment): unit tests for the
// discipline estimate rollup pure functions (lib/architecture/estimate-rollup.ts).
// Fixtures build minimal BoardPage/ArchitectureNodeDetails shapes -- no
// Supabase, no server imports.

import { describe, expect, it } from "vitest";
import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails, DisciplineEstimate } from "@/lib/architecture/types";
import { computeRollups, computeSiteTotals, parseEstimateInput } from "@/lib/architecture/estimate-rollup";

const PAGE_A = "00000000-0000-4000-8000-0000000000a1";
const PAGE_B = "00000000-0000-4000-8000-0000000000a2";
const SECTION_A1 = "00000000-0000-4000-8000-0000000000b1";
const SECTION_A2 = "00000000-0000-4000-8000-0000000000b2";
const SECTION_B1 = "00000000-0000-4000-8000-0000000000b3";

function estimate(discipline: DisciplineEstimate["discipline"], minutes: number): DisciplineEstimate {
  return { discipline, minutes, note: null, estimatedBy: null };
}

function page(id: string, sectionIds: string[]): BoardPage {
  return {
    id,
    title: id,
    pageSlug: `/${id}`,
    pageKind: "static",
    position: 0,
    description: null,
    sections: sectionIds.map((sid, i) => ({
      id: sid,
      title: sid,
      position: i,
      kind: "static",
      component: null,
    })),
  };
}

describe("computeRollups", () => {
  it("test_own_estimate_takes_precedence_over_sections", () => {
    const pages = [page(PAGE_A, [SECTION_A1])];
    const details: ArchitectureNodeDetails = new Map([
      [PAGE_A, { estimates: [estimate("design", 120)], meta: null }],
      [SECTION_A1, { estimates: [estimate("design", 60)], meta: null }],
    ]);

    const rollups = computeRollups(pages, details);
    const r = rollups.get(PAGE_A)!;

    expect(r.byDiscipline.design).toBe(120);
    expect(r.source).toBe("own");
    expect(r.conflicts).toBe(true);
  });

  it("test_rolled_from_sections_when_no_page_own", () => {
    const pages = [page(PAGE_A, [SECTION_A1, SECTION_A2])];
    const details: ArchitectureNodeDetails = new Map([
      [SECTION_A1, { estimates: [estimate("development", 30)], meta: null }],
      [SECTION_A2, { estimates: [estimate("development", 90)], meta: null }],
    ]);

    const rollups = computeRollups(pages, details);
    const r = rollups.get(PAGE_A)!;

    expect(r.byDiscipline.development).toBe(120);
    expect(r.source).toBe("rolled");
    expect(r.conflicts).toBe(false);
  });

  it("test_per_discipline_precedence", () => {
    const pages = [page(PAGE_A, [SECTION_A1])];
    const details: ArchitectureNodeDetails = new Map([
      [PAGE_A, { estimates: [estimate("design", 120)], meta: null }],
      [SECTION_A1, { estimates: [estimate("development", 60)], meta: null }],
    ]);

    const rollups = computeRollups(pages, details);
    const r = rollups.get(PAGE_A)!;

    expect(r.byDiscipline.design).toBe(120);
    expect(r.byDiscipline.development).toBe(60);
    expect(r.conflicts).toBe(false);
  });

  it("test_site_total_no_double_count", () => {
    const pages = [page(PAGE_A, [SECTION_A1])];
    const details: ArchitectureNodeDetails = new Map([
      [PAGE_A, { estimates: [estimate("design", 480)], meta: null }],
      [SECTION_A1, { estimates: [estimate("design", 360)], meta: null }],
    ]);

    const rollups = computeRollups(pages, details);
    const totals = computeSiteTotals(rollups);

    expect(totals.design).toBe(480);
    expect(totals.design).not.toBe(840);
  });

  it("test_empty_page_no_estimates", () => {
    const pages = [page(PAGE_B, [])];
    const details: ArchitectureNodeDetails = new Map();

    const rollups = computeRollups(pages, details);
    const r = rollups.get(PAGE_B)!;

    expect(r.source).toBe("none");
    expect(r.total).toBe(0);
    expect(r.conflicts).toBe(false);
  });

  it("test_conflicts_false_when_same_value", () => {
    const pages = [page(PAGE_A, [SECTION_A1])];
    const details: ArchitectureNodeDetails = new Map([
      [PAGE_A, { estimates: [estimate("design", 120)], meta: null }],
      [SECTION_A1, { estimates: [estimate("design", 120)], meta: null }],
    ]);

    const rollups = computeRollups(pages, details);
    const r = rollups.get(PAGE_A)!;

    expect(r.byDiscipline.design).toBe(120);
    expect(r.conflicts).toBe(false);
  });
});

describe("parseEstimateInput", () => {
  it("parses hours+minutes, hours only, and bare minutes", () => {
    expect(parseEstimateInput("1h30m")).toBe(90);
    expect(parseEstimateInput("2h")).toBe(120);
    expect(parseEstimateInput("45")).toBe(45);
    expect(parseEstimateInput("45m")).toBe(45);
  });

  it("returns null for unsupported input", () => {
    expect(parseEstimateInput("abc")).toBeNull();
    expect(parseEstimateInput("")).toBeNull();
  });
});
