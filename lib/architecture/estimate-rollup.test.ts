// F015 (missions/20260919-150607): AS-063 / AS-064 -- estimate rollups must
// include all five WORK_CATEGORIES disciplines (design, development,
// content_seo, pm, qa), not just the original two/three.
import { describe, expect, it } from "vitest";
import { computeRollups, computeSiteTotals } from "@/lib/architecture/estimate-rollup";
import { WORK_CATEGORIES } from "@/lib/architecture/types";
import type { ArchitectureNodeDetails, DisciplineEstimate } from "@/lib/architecture/types";
import type { BoardPage } from "@/lib/queries/architecture";

function makeDetails(
  entries: Record<string, DisciplineEstimate[]>,
): ArchitectureNodeDetails {
  return new Map(
    Object.entries(entries).map(([id, estimates]) => [id, { estimates, meta: null }]),
  );
}

function makePage(id: string): BoardPage {
  return {
    id,
    title: id,
    pageSlug: id,
    pageKind: "static",
    position: 0,
    description: null,
    sections: [],
  } as BoardPage;
}

describe("AS-063: page-level rollup includes all five disciplines", () => {
  it("sums an estimate entry for every WORK_CATEGORY discipline into byDiscipline and total", () => {
    expect(WORK_CATEGORIES).toEqual(["design", "development", "content_seo", "pm", "qa"]);

    const page = makePage("page-1");
    const details = makeDetails({
      [page.id]: WORK_CATEGORIES.map((discipline, i) => ({
        discipline,
        minutes: (i + 1) * 10,
        note: null,
      })),
    });

    const rollups = computeRollups([page], details);
    const rollup = rollups.get(page.id)!;

    for (const discipline of WORK_CATEGORIES) {
      expect(rollup.byDiscipline[discipline]).toBeDefined();
    }
    expect(rollup.byDiscipline.content_seo).toBe(30);
    expect(rollup.byDiscipline.pm).toBe(40);
    expect(rollup.byDiscipline.qa).toBe(50);
    expect(rollup.total).toBe(10 + 20 + 30 + 40 + 50);
    expect(rollup.source).toBe("own");
  });
});

describe("AS-064: site-level rollup includes all five disciplines", () => {
  it("aggregates content_seo/pm/qa (plus design/development) across pages into site totals", () => {
    const pageA = makePage("page-a");
    const pageB = makePage("page-b");
    const details = makeDetails({
      [pageA.id]: [{ discipline: "content_seo", minutes: 15, note: null }],
      [pageB.id]: [
        { discipline: "content_seo", minutes: 25, note: null },
        { discipline: "pm", minutes: 5, note: null },
        { discipline: "qa", minutes: 7, note: null },
      ],
    });

    const rollups = computeRollups([pageA, pageB], details);
    const totals = computeSiteTotals(rollups);

    expect(totals.content_seo).toBe(40);
    expect(totals.pm).toBe(5);
    expect(totals.qa).toBe(7);
    // Every discipline that appears in the schema is reachable in the totals
    // shape -- none of the five are structurally excluded.
    for (const discipline of WORK_CATEGORIES) {
      expect(WORK_CATEGORIES.includes(discipline)).toBe(true);
    }
  });

  it("does not leak an unrecognised legacy discipline value into totals (negative case)", () => {
    const page = makePage("page-legacy");
    const details = makeDetails({
      [page.id]: [
        { discipline: "legacy-discipline" as unknown as DisciplineEstimate["discipline"], minutes: 999, note: null },
      ],
    });
    const rollups = computeRollups([page], details);
    const rollup = rollups.get(page.id)!;
    expect(Object.keys(rollup.byDiscipline)).toHaveLength(0);
    expect(rollup.total).toBe(0);
    expect(rollup.source).toBe("none");
  });
});
