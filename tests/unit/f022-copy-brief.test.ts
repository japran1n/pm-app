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
    clientVisible: true,
    updatedBy: null,
    ...overrides,
  };
}

function estimate(discipline: DisciplineEstimate["discipline"], minutes: number): DisciplineEstimate {
  return { discipline, minutes, note: null, estimatedBy: null };
}

function page(id: string, title: string, sectionIds: string[] = []): BoardPage {
  return {
    id,
    title,
    pageSlug: `/${title.toLowerCase()}`,
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
    const details: ArchitectureNodeDetails = new Map([
      [
        PAGE_A,
        {
          estimates: [estimate("design", 120), estimate("development", 60), estimate("qa", 30), estimate("pm", 15), estimate("content_seo", 45)],
          meta: meta({ intent: "Convert visitors" }),
        },
      ],
      [SECTION_A1, { estimates: [estimate("development", 90)], meta: null }],
    ]);

    const md = toCopyBriefMarkdown(pages, details);

    expect(md).not.toMatch(/minutes/i);
    expect(md).not.toMatch(/design/i);
    expect(md).not.toMatch(/development/i);
    expect(md).not.toMatch(/content_seo/i);
    expect(md).not.toMatch(/\bpm\b/i);
    expect(md).not.toMatch(/\bqa\b/i);
    expect(md).not.toMatch(/estimate/i);
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
});
