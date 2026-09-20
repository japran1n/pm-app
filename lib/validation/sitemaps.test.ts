// Standalone Sitemap tool, Phase 1: slug and reorder-payload validation
// coverage for lib/validation/sitemaps.ts, mirroring
// lib/validation/architecture.ts's own slug pattern rules exactly (per
// this feature's Clarified implementation -- the kind vocabularies are a
// deliberate mirror, so the slug rules are too).

import { describe, expect, it } from "vitest";
import {
  createSitemapPageSchema,
  reslugSitemapPageSchema,
  reorderSitemapPagesSchema,
  reorderSitemapSectionsSchema,
  sitemapPageKindEnum,
  sitemapSectionKindEnum,
} from "@/lib/validation/sitemaps";

const uuid1 = "11111111-1111-4111-8111-111111111111";
const uuid2 = "22222222-2222-4222-8222-222222222222";
const uuid3 = "33333333-3333-4333-8333-333333333333";

describe("createSitemapPageSchema slug handling", () => {
  it("accepts lowercase-hyphen slugs", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "pricing",
    });
    expect(result.success).toBe(true);
  });

  it("accepts nested path slugs separated by /", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "SEO landing",
      slug: "services/seo",
    });
    expect(result.success).toBe(true);
  });

  it("rejects uppercase characters", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "Pricing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects slugs with spaces", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "our pricing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a leading slash", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "/pricing",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a double slash", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "services//seo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty slug", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "   ",
    });
    expect(result.success).toBe(false);
  });

  it("defaults kind to 'static' when omitted", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "pricing",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe("static");
    }
  });

  it("rejects a kind outside the mirrored BoardPageKind vocabulary", () => {
    const result = createSitemapPageSchema.safeParse({
      sitemapId: uuid1,
      title: "Pricing",
      slug: "pricing",
      kind: "landing",
    });
    expect(result.success).toBe(false);
  });
});

describe("sitemapPageKindEnum / sitemapSectionKindEnum mirror BoardPageKind/BoardSectionKind", () => {
  it("page kind accepts exactly static | cms | cms_template | utility", () => {
    for (const kind of ["static", "cms", "cms_template", "utility"]) {
      expect(sitemapPageKindEnum.safeParse(kind).success).toBe(true);
    }
    expect(sitemapPageKindEnum.safeParse("other").success).toBe(false);
  });

  it("section kind accepts exactly static | cms", () => {
    for (const kind of ["static", "cms"]) {
      expect(sitemapSectionKindEnum.safeParse(kind).success).toBe(true);
    }
    expect(sitemapSectionKindEnum.safeParse("cms_template").success).toBe(false);
  });
});

describe("reslugSitemapPageSchema", () => {
  it("accepts a valid pageId/slug pair", () => {
    expect(reslugSitemapPageSchema.safeParse({ pageId: uuid1, slug: "new-slug" }).success).toBe(true);
  });

  it("rejects a non-uuid pageId", () => {
    expect(reslugSitemapPageSchema.safeParse({ pageId: "not-a-uuid", slug: "new-slug" }).success).toBe(false);
  });
});

describe("reorderSitemapPagesSchema position-handling payload", () => {
  it("accepts a list of distinct page ids", () => {
    const result = reorderSitemapPagesSchema.safeParse({
      sitemapId: uuid1,
      pageIds: [uuid2, uuid3],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a duplicate id in the reorder list", () => {
    const result = reorderSitemapPagesSchema.safeParse({
      sitemapId: uuid1,
      pageIds: [uuid2, uuid2],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty reorder list", () => {
    const result = reorderSitemapPagesSchema.safeParse({ sitemapId: uuid1, pageIds: [] });
    expect(result.success).toBe(false);
  });
});

describe("reorderSitemapSectionsSchema position-handling payload", () => {
  it("accepts a list of distinct section ids", () => {
    const result = reorderSitemapSectionsSchema.safeParse({
      pageId: uuid1,
      sectionIds: [uuid2, uuid3],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a duplicate id in the reorder list", () => {
    const result = reorderSitemapSectionsSchema.safeParse({
      pageId: uuid1,
      sectionIds: [uuid2, uuid2],
    });
    expect(result.success).toBe(false);
  });
});
