// F030 (missions/20260919-150607): combined test feature for F028
// (markdown export section meta) + F029 (JSON export section meta).
//
// AS-103: a section with node_meta (keywords + copy_status) appears in BOTH
// markdown and JSON exports carrying that meta; a section WITHOUT node_meta
// appears without meta, in both exports.
// AS-105: discipline estimates (minutes, discipline, note, estimatedBy)
// never appear in either export's output.
//
// Fixtures are concrete -- a section with a populated NodeMeta and a
// sibling section with none -- not shape-only assertions.

import { describe, expect, it } from "vitest";
import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails, DisciplineEstimate, NodeMeta } from "@/lib/architecture/types";
import { toCopyBriefJson, toCopyBriefMarkdown } from "@/lib/architecture/copy-brief";

const PAGE_A = "00000000-0000-4000-8000-0000000000c1";
const SECTION_WITH_META = "00000000-0000-4000-8000-0000000000c2";
const SECTION_WITHOUT_META = "00000000-0000-4000-8000-0000000000c3";

function meta(overrides: Partial<NodeMeta>): NodeMeta {
  return {
    intent: null,
    audience: null,
    primaryCta: null,
    tone: null,
    keywords: [],
    copyStatus: "not_started",
    ...overrides,
  };
}

function estimate(discipline: DisciplineEstimate["discipline"], minutes: number): DisciplineEstimate {
  return { discipline, minutes, note: "Needs review" };
}

function page(id: string, title: string, sectionIds: string[]): BoardPage {
  return {
    id,
    title,
    pageSlug: `/${title.toLowerCase()}`,
    pageKind: "static",
    position: 0,
    description: null,
    sections: sectionIds.map((sid, i) => ({
      id: sid,
      title: `Section ${i + 1}`,
      position: i,
      kind: "static",
      component: null,
    })),
  };
}

describe("F030 AS-103: section meta appears in both exports", () => {
  const pages = [page(PAGE_A, "Home", [SECTION_WITH_META, SECTION_WITHOUT_META])];
  const details: ArchitectureNodeDetails = new Map([
    [
      SECTION_WITH_META,
      {
        estimates: [],
        meta: meta({ keywords: ["pricing", "conversion"], copyStatus: "drafted" }),
      },
    ],
    [SECTION_WITHOUT_META, { estimates: [], meta: null }],
  ]);

  it("test_AS_103_markdown_shows_meta_for_section_with_meta", () => {
    const md = toCopyBriefMarkdown(pages, details);
    expect(md).toContain("Keywords: pricing, conversion");
    expect(md).toContain("Copy status: drafted");
  });

  it("test_AS_103_markdown_shows_no_brief_yet_for_section_without_meta", () => {
    const md = toCopyBriefMarkdown(pages, details);
    // The section without meta must render the empty-state marker, not any
    // meta fields.
    const lines = md.split("\n");
    const sectionTwoIndex = lines.findIndex((l) => l.includes("Section 2"));
    expect(sectionTwoIndex).toBeGreaterThan(-1);
    const followingLines = lines.slice(sectionTwoIndex, sectionTwoIndex + 4).join("\n");
    expect(followingLines).toContain("_No brief yet._");
    expect(followingLines).not.toContain("Keywords:");
    expect(followingLines).not.toContain("Copy status:");
  });

  it("test_AS_100_markdown_nests_meta_three_spaces_under_its_section", () => {
    const md = toCopyBriefMarkdown(pages, details);
    // Positionally-scoped window (mirrors the sitemap-io.test.ts AS-102
    // pattern): the section-with-meta's numbered line is immediately
    // followed by its
    // three-space-indented meta lines, not a global substring check.
    const lines = md.split("\n");
    const sectionOneIndex = lines.findIndex((l) => l.includes("Section 1"));
    expect(sectionOneIndex).toBeGreaterThan(-1);
    const window = lines.slice(sectionOneIndex, sectionOneIndex + 3);
    expect(window[0]).toMatch(/^1\.\s+\*\*Section 1\*\*/);
    expect(window[1]).toBe("   - Keywords: pricing, conversion");
    expect(window[2]).toBe("   - Copy status: drafted");
  });

  it("test_AS_103_json_shows_meta_for_section_with_meta", () => {
    const parsed = JSON.parse(toCopyBriefJson(pages, details));
    const sections = parsed[0].sections;
    const withMeta = sections.find((s: { title: string }) => s.title === "Section 1");
    expect(withMeta.meta).not.toBeNull();
    expect(withMeta.meta.keywords).toEqual(["pricing", "conversion"]);
    expect(withMeta.meta.copyStatus).toBe("drafted");
  });

  it("test_AS_103_json_shows_null_meta_for_section_without_meta", () => {
    const parsed = JSON.parse(toCopyBriefJson(pages, details));
    const sections = parsed[0].sections;
    const withoutMeta = sections.find((s: { title: string }) => s.title === "Section 2");
    expect(withoutMeta.meta).toBeNull();
  });
});

describe("F030 AS-105: discipline estimates never appear in either export", () => {
  const pages = [page(PAGE_A, "Home", [SECTION_WITH_META, SECTION_WITHOUT_META])];

  // Fixture-driven: covers minutes in any format (180, 30, 15, 10, 45 --
  // including values that would slip past 180m/180min/3h-style formats
  // since assertions below use plain substring checks, not \b-bounded
  // regex) plus every discipline value and the note/estimatedBy fields.
  const ESTIMATES: DisciplineEstimate[] = [
    estimate("design", 180),
    estimate("development", 240),
    estimate("qa", 30),
    estimate("content_seo", 15),
    estimate("pm", 10),
    estimate("development", 45),
  ];

  const details: ArchitectureNodeDetails = new Map([
    [
      PAGE_A,
      {
        estimates: [ESTIMATES[0], ESTIMATES[1]],
        meta: meta({ keywords: ["home"], copyStatus: "approved" }),
      },
    ],
    [
      SECTION_WITH_META,
      {
        estimates: [ESTIMATES[2], ESTIMATES[3], ESTIMATES[4]],
        meta: meta({ keywords: ["pricing"], copyStatus: "in_review" }),
      },
    ],
    [SECTION_WITHOUT_META, { estimates: [ESTIMATES[5]], meta: null }],
  ]);

  function assertNoEstimateLeakage(output: string) {
    expect(output).not.toMatch(/minutes/i);
    expect(output).not.toMatch(/discipline/i);
    expect(output).not.toMatch(/estimated_by/i);
    expect(output).not.toMatch(/estimatedBy/i);
    for (const e of ESTIMATES) {
      expect(output).not.toContain(String(e.minutes));
      expect(output).not.toContain(e.discipline);
      if (e.note != null) expect(output).not.toContain(e.note);
    }
  }

  it("test_AS_105_markdown_excludes_estimate_fields_and_values", () => {
    const md = toCopyBriefMarkdown(pages, details);
    assertNoEstimateLeakage(md);
  });

  it("test_AS_105_json_excludes_estimate_fields_and_values", () => {
    const json = toCopyBriefJson(pages, details);
    assertNoEstimateLeakage(json);

    const parsed = JSON.parse(json);
    for (const p of parsed) {
      expect(p).not.toHaveProperty("estimates");
      for (const s of p.sections) {
        expect(s).not.toHaveProperty("estimates");
      }
    }
  });

  it("test_AS_105_markdown_excludes_estimate_fields_and_values_under_pageSlug_filter", () => {
    const md = toCopyBriefMarkdown(pages, details, { pageSlug: "/home" });
    assertNoEstimateLeakage(md);
    // Section meta is still present under the filter -- exclusion isn't
    // just an artifact of the section being dropped entirely.
    expect(md).toContain("Keywords: pricing");
  });

  it("test_AS_105_json_excludes_estimate_fields_and_values_under_pageSlug_filter", () => {
    const json = toCopyBriefJson(pages, details, { pageSlug: "/home" });
    assertNoEstimateLeakage(json);

    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    for (const p of parsed) {
      expect(p).not.toHaveProperty("estimates");
      for (const s of p.sections) {
        expect(s).not.toHaveProperty("estimates");
      }
    }
    expect(parsed[0].sections[0].meta.keywords).toEqual(["pricing"]);
  });
});
