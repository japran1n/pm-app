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
    clientVisible: true,
    updatedBy: null,
    ...overrides,
  };
}

function estimate(discipline: DisciplineEstimate["discipline"], minutes: number): DisciplineEstimate {
  return { discipline, minutes, note: "Needs review", estimatedBy: "user-123" };
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
  const details: ArchitectureNodeDetails = new Map([
    [
      PAGE_A,
      {
        estimates: [estimate("design", 180), estimate("development", 240)],
        meta: meta({ keywords: ["home"], copyStatus: "approved" }),
      },
    ],
    [
      SECTION_WITH_META,
      {
        estimates: [estimate("qa", 30), estimate("content_seo", 15), estimate("pm", 10)],
        meta: meta({ keywords: ["pricing"], copyStatus: "in_review" }),
      },
    ],
    [SECTION_WITHOUT_META, { estimates: [estimate("development", 45)], meta: null }],
  ]);

  it("test_AS_105_markdown_excludes_estimate_fields_and_values", () => {
    const md = toCopyBriefMarkdown(pages, details);
    expect(md).not.toMatch(/minutes/i);
    expect(md).not.toMatch(/discipline/i);
    expect(md).not.toMatch(/estimated_by/i);
    expect(md).not.toMatch(/estimatedBy/i);
    expect(md).not.toContain("Needs review");
    expect(md).not.toContain("user-123");
    expect(md).not.toMatch(/\b180\b/);
    expect(md).not.toMatch(/\b240\b/);
  });

  it("test_AS_105_json_excludes_estimate_fields_and_values", () => {
    const json = toCopyBriefJson(pages, details);
    expect(json).not.toMatch(/minutes/i);
    expect(json).not.toMatch(/discipline/i);
    expect(json).not.toMatch(/estimated_by/i);
    expect(json).not.toMatch(/estimatedBy/i);
    expect(json).not.toContain("Needs review");
    expect(json).not.toContain("user-123");
    expect(json).not.toMatch(/\b180\b/);
    expect(json).not.toMatch(/\b240\b/);

    const parsed = JSON.parse(json);
    for (const p of parsed) {
      expect(p).not.toHaveProperty("estimates");
      for (const s of p.sections) {
        expect(s).not.toHaveProperty("estimates");
      }
    }
  });
});
