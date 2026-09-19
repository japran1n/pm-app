// F22 (missions/20260918-architecture-enrichment): unit tests for the pure
// copy brief export functions (lib/architecture/copy-brief.ts). Fixtures
// build minimal BoardPage/ArchitectureNodeDetails shapes -- no Supabase, no
// server imports.

import { describe, expect, it } from "vitest";
import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails, DisciplineEstimate, NodeMeta } from "@/lib/architecture/types";
import { toCopyBriefJson, toCopyBriefMarkdown } from "@/lib/architecture/copy-brief";

const PAGE_A = "00000000-0000-4000-8000-0000000000a1";
const PAGE_B = "00000000-0000-4000-8000-0000000000a2";
const PAGE_C = "00000000-0000-4000-8000-0000000000a3";
const SECTION_A1 = "00000000-0000-4000-8000-0000000000b1";

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
  return { discipline, minutes, note: null };
}

function page(id: string, title: string, sectionIds: string[] = []): BoardPage {
  return {
    id,
    title,
    pageSlug: `/${title.toLowerCase()}`,
    pageKind: "static",
    position: 0,
    sections: sectionIds.map((sid, i) => ({
      id: sid,
      title: sid,
      position: i,
      kind: "static",
      component: null,
    })),
  };
}

describe("toCopyBriefMarkdown", () => {
  it("test_markdown_omits_empty_fields", () => {
    const pages = [page(PAGE_A, "Home")];
    const details: ArchitectureNodeDetails = new Map([
      [PAGE_A, { estimates: [], meta: meta({ intent: "Convert visitors" }) }],
    ]);

    const md = toCopyBriefMarkdown(pages, details);

    expect(md).toContain("Intent:");
    expect(md).not.toContain("Audience:");
    expect(md).not.toContain("Primary CTA:");
  });

  it("test_no_brief_yet_when_no_meta", () => {
    const pages = [page(PAGE_A, "Home")];
    const details: ArchitectureNodeDetails = new Map();

    const md = toCopyBriefMarkdown(pages, details);

    expect(md).toContain("_No brief yet._");
  });

  it("test_estimates_never_in_brief", () => {
    const pages = [page(PAGE_A, "Home", [SECTION_A1])];
    // Fixture-driven: covers every discipline value plus minutes in the
    // exact numeric form stored (no \b-bounded regex, so e.g. 180m/3h
    // formats containing these digits would also be caught).
    const ESTIMATES: DisciplineEstimate[] = [
      estimate("design", 120),
      estimate("development", 60),
      estimate("qa", 30),
      estimate("content_seo", 45),
      estimate("pm", 90),
    ];
    const details: ArchitectureNodeDetails = new Map([
      [
        PAGE_A,
        {
          estimates: [ESTIMATES[0], ESTIMATES[1]],
          meta: meta({ intent: "Convert visitors" }),
        },
      ],
      [SECTION_A1, { estimates: [ESTIMATES[2], ESTIMATES[3], ESTIMATES[4]], meta: null }],
    ]);

    const md = toCopyBriefMarkdown(pages, details);

    expect(md).not.toMatch(/minutes/i);
    expect(md).not.toMatch(/estimate/i);
    for (const e of ESTIMATES) {
      expect(md).not.toContain(String(e.minutes));
      expect(md).not.toContain(e.discipline);
      if (e.note != null) expect(md).not.toContain(e.note);
    }
  });

  it("test_estimates_never_in_brief_json", () => {
    const pages = [page(PAGE_A, "Home", [SECTION_A1])];
    const ESTIMATES: DisciplineEstimate[] = [
      estimate("design", 120),
      estimate("development", 60),
      estimate("qa", 30),
      estimate("content_seo", 45),
      estimate("pm", 90),
    ];
    const details: ArchitectureNodeDetails = new Map([
      [
        PAGE_A,
        {
          estimates: [ESTIMATES[0], ESTIMATES[1]],
          meta: meta({ intent: "Convert visitors" }),
        },
      ],
      [SECTION_A1, { estimates: [ESTIMATES[2], ESTIMATES[3], ESTIMATES[4]], meta: null }],
    ]);

    const json = toCopyBriefJson(pages, details);

    expect(json).not.toMatch(/minutes/i);
    expect(json).not.toMatch(/estimate/i);
    for (const e of ESTIMATES) {
      expect(json).not.toContain(String(e.minutes));
      expect(json).not.toContain(e.discipline);
      if (e.note != null) expect(json).not.toContain(e.note);
    }
  });

  it("test_estimates_never_in_brief_under_pageSlug_filter", () => {
    const pages = [page(PAGE_A, "Home", [SECTION_A1]), page(PAGE_B, "About")];
    const ESTIMATES: DisciplineEstimate[] = [
      estimate("design", 120),
      estimate("qa", 30),
    ];
    const details: ArchitectureNodeDetails = new Map([
      [SECTION_A1, { estimates: [ESTIMATES[1]], meta: meta({ keywords: ["hero"], copyStatus: "approved" }) }],
      [PAGE_A, { estimates: [ESTIMATES[0]], meta: meta({ intent: "Convert visitors" }) }],
    ]);

    const md = toCopyBriefMarkdown(pages, details, { pageSlug: "/home" });
    const json = toCopyBriefJson(pages, details, { pageSlug: "/home" });

    for (const e of ESTIMATES) {
      expect(md).not.toContain(String(e.minutes));
      expect(md).not.toContain(e.discipline);
      expect(json).not.toContain(String(e.minutes));
      expect(json).not.toContain(e.discipline);
    }
    // Section meta is still present under the filter, proving exclusion
    // isn't just because the section itself is missing.
    expect(md).toContain("Keywords: hero");
    const parsed = JSON.parse(json);
    expect(parsed[0].sections[0].meta.keywords).toEqual(["hero"]);
  });

  // F029 (missions/20260919-150607), AS-104 markdown gap: exporting with a
  // pageSlug filter still includes the meta of that page's own sections in
  // the markdown output, not just the JSON output.
  it("test_AS_104_pageslug_filter_includes_section_meta_markdown", () => {
    const pages = [page(PAGE_A, "Home", [SECTION_A1]), page(PAGE_B, "About")];
    const details: ArchitectureNodeDetails = new Map([
      [
        SECTION_A1,
        { estimates: [], meta: meta({ keywords: ["hero"], copyStatus: "approved" }) },
      ],
    ]);

    const md = toCopyBriefMarkdown(pages, details, { pageSlug: "/home" });

    expect(md).toContain("Home");
    expect(md).not.toContain("About");
    expect(md).toContain("Keywords: hero");
    expect(md).toContain("Copy status: approved");
  });

  it("test_scope_slug_filters_to_one_page", () => {
    const pages = [page(PAGE_A, "Home"), page(PAGE_B, "About"), page(PAGE_C, "Contact")];
    const details: ArchitectureNodeDetails = new Map();

    const md = toCopyBriefMarkdown(pages, details, { pageSlug: "/about" });

    expect(md).toContain("About");
    expect(md).not.toContain("Home");
    expect(md).not.toContain("Contact");
  });
});

describe("toCopyBriefJson", () => {
  it("test_json_meta_null_when_no_meta", () => {
    const pages = [page(PAGE_A, "Home")];
    const details: ArchitectureNodeDetails = new Map();

    const parsed = JSON.parse(toCopyBriefJson(pages, details));

    expect(parsed[0].meta).toBeNull();
  });

  // F029 (missions/20260919-150607), AS-101: a section's meta (keywords,
  // copyStatus, etc.) appears under that section in toCopyBriefJson, not
  // merged into or overwritten by the page's own meta.
  it("test_AS_101_section_meta_appears_under_that_section", () => {
    const pages = [page(PAGE_A, "Home", [SECTION_A1])];
    const details: ArchitectureNodeDetails = new Map([
      [PAGE_A, { estimates: [], meta: meta({ intent: "Page intent" }) }],
      [
        SECTION_A1,
        {
          estimates: [],
          meta: meta({ keywords: ["hero", "signup"], copyStatus: "drafted" }),
        },
      ],
    ]);

    const parsed = JSON.parse(toCopyBriefJson(pages, details));

    expect(parsed[0].meta.intent).toBe("Page intent");
    expect(parsed[0].sections[0].meta.keywords).toEqual(["hero", "signup"]);
    expect(parsed[0].sections[0].meta.copyStatus).toBe("drafted");
    // The section's meta must not leak onto the page's own meta.
    expect(parsed[0].meta.keywords).toEqual([]);
  });

  // F029, AS-104: exporting with a pageSlug filter still includes the
  // meta of that page's own sections (not just the page-level meta).
  it("test_AS_104_pageslug_filter_includes_section_meta", () => {
    const pages = [
      page(PAGE_A, "Home", [SECTION_A1]),
      page(PAGE_B, "About"),
    ];
    const details: ArchitectureNodeDetails = new Map([
      [
        SECTION_A1,
        { estimates: [], meta: meta({ keywords: ["hero"], copyStatus: "approved" }) },
      ],
    ]);

    const parsed = JSON.parse(toCopyBriefJson(pages, details, { pageSlug: "/home" }));

    expect(parsed).toHaveLength(1);
    expect(parsed[0].slug).toBe("/home");
    expect(parsed[0].sections[0].meta.keywords).toEqual(["hero"]);
    expect(parsed[0].sections[0].meta.copyStatus).toBe("approved");
  });
});
