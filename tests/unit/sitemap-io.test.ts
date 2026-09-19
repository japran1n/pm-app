// Unit coverage for lib/architecture/sitemap-io.ts -- pure string in/out,
// so the export formats and the importer's normalisation are provable
// without a DB, a DOM, or an XML parser dependency.

import { describe, expect, it } from "vitest";
import type { BoardPage } from "@/lib/queries/architecture";
import type { ArchitectureNodeDetails, NodeMeta } from "@/lib/architecture/types";
import {
  parseSitemap,
  toCsv,
  toJson,
  toMarkdown,
  toSitemapXml,
} from "@/lib/architecture/sitemap-io";

function meta(overrides: Partial<NodeMeta> = {}): NodeMeta {
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

function page(overrides: Partial<BoardPage> & { pageSlug: string }): BoardPage {
  return {
    id: overrides.pageSlug || "root",
    title: overrides.title ?? "Untitled",
    pageSlug: overrides.pageSlug,
    pageKind: overrides.pageKind ?? "static",
    position: overrides.position ?? 0,
    sections: overrides.sections ?? [],
  };
}

const PAGES: BoardPage[] = [
  page({ pageSlug: "", title: "Home", position: 0 }),
  page({ pageSlug: "about", title: "About", position: 1 }),
  page({ pageSlug: "about/team", title: "Team", position: 2 }),
  page({ pageSlug: "blogg/post", title: "Post", pageKind: "cms_template", position: 3 }),
];

describe("toSitemapXml", () => {
  it("emits one loc per page, root as baseUrl + slash, with single slashes", () => {
    const xml = toSitemapXml(PAGES, "https://example.com/");
    expect(xml).toContain("<loc>https://example.com/</loc>");
    expect(xml).toContain("<loc>https://example.com/about</loc>");
    expect(xml).toContain("<loc>https://example.com/about/team</loc>");
    expect(xml).not.toContain("example.com//");
  });

  it("xml-escapes values", () => {
    const xml = toSitemapXml([page({ pageSlug: "a&b" })], "https://example.com");
    expect(xml).toContain("a&amp;b");
  });

  it("round-trips back through parseSitemap", () => {
    const result = parseSitemap(toSitemapXml(PAGES, "https://example.com"));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages.map((entry) => entry.path)).toEqual([
      "",
      "about",
      "about/team",
      "blogg",
      "blogg/post",
    ]);
  });

  it("ignores xhtml:link alternates", () => {
    const xml = `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://example.com/about</loc>
        <xhtml:link rel="alternate" hreflang="sv" href="https://example.com/om-oss"/>
      </url></urlset>`;
    const result = parseSitemap(xml);
    expect(result.ok && result.pages.map((p) => p.path)).toEqual(["about"]);
  });
});

describe("toCsv", () => {
  it("escapes commas and quotes per RFC 4180", () => {
    const csv = toCsv([
      page({ pageSlug: "x", title: 'Hello, "world"', position: 0 }),
    ]);
    expect(csv.split("\n")[0]).toBe("path,title,kind,depth,parent_path,sections");
    expect(csv.split("\n")[1]).toBe('x,"Hello, ""world""",static,1,,');
  });

  it("reports depth, parent path and joined sections", () => {
    const csv = toCsv([
      page({
        pageSlug: "about/team",
        title: "Team",
        sections: [
          { id: "1", title: "Hero", kind: "static", position: 0, component: null },
          { id: "2", title: "Grid", kind: "static", position: 1, component: null },
        ],
      }),
    ]);
    expect(csv.split("\n")[1]).toBe("about/team,Team,static,2,about,Hero; Grid");
  });
});

describe("toMarkdown", () => {
  it("indents two spaces per depth level and includes folders", () => {
    const markdown = toMarkdown([
      page({ pageSlug: "", title: "Home", position: 0 }),
      page({ pageSlug: "legal/privacy", title: "Privacy", position: 1 }),
    ]);
    expect(markdown.split("\n")).toEqual([
      "- Home ``",
      "  - Legal `legal`",
      "    - Privacy `legal/privacy`",
    ]);
  });

  it("AS-100: includes a meta block for a section that has node_meta", () => {
    const home = page({
      pageSlug: "",
      title: "Home",
      position: 0,
      sections: [
        { id: "sec-1", title: "Hero", position: 0, kind: "static", component: null },
      ],
    });
    const details: ArchitectureNodeDetails = new Map([
      ["sec-1", { estimates: [], meta: meta({ copyStatus: "approved", keywords: ["seo", "hero"] }) }],
    ]);

    const markdown = toMarkdown([home], details);

    expect(markdown).toContain("Hero <!-- meta:");
    expect(markdown).toContain("copy_status: approved");
    expect(markdown).toContain("keywords: seo, hero");
  });

  it("AS-102: omits the meta block when a section has no node_meta", () => {
    const home = page({
      pageSlug: "",
      title: "Home",
      position: 0,
      sections: [
        { id: "sec-2", title: "Hero", position: 0, kind: "static", component: null },
      ],
    });
    const details: ArchitectureNodeDetails = new Map();

    const markdown = toMarkdown([home], details);

    expect(markdown).toContain("- Hero");
    expect(markdown).not.toContain("<!--");
  });

  it("AS-102: omits the meta block entirely when no details are passed at all", () => {
    const home = page({
      pageSlug: "",
      title: "Home",
      position: 0,
      sections: [
        { id: "sec-3", title: "Hero", position: 0, kind: "static", component: null },
      ],
    });

    const markdown = toMarkdown([home]);

    expect(markdown).not.toContain("<!--");
  });
});

describe("toJson", () => {
  it("round-trips through parseSitemap preserving titles and kinds", () => {
    const result = parseSitemap(toJson(PAGES));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pages).toContainEqual({
      path: "blogg/post",
      title: "Post",
      kind: "cms_template",
    });
    expect(result.pages.find((entry) => entry.path === "blogg")).toEqual({
      path: "blogg",
      title: "Blogg",
    });
  });

  // F029 (missions/20260919-150607), AS-101: JSON export includes section
  // meta (copyStatus, keywords) when a details map is supplied and the
  // section has node_meta worth reporting.
  it("test_AS_101_json_export_includes_section_meta_when_present", () => {
    const pages: BoardPage[] = [
      page({
        pageSlug: "about",
        title: "About",
        sections: [
          { id: "s1", title: "Hero", kind: "static", position: 0, component: null },
          { id: "s2", title: "Grid", kind: "static", position: 1, component: null },
        ],
      }),
    ];
    const details: ArchitectureNodeDetails = new Map([
      [
        "s1",
        {
          estimates: [],
          meta: meta({ keywords: ["welcome", "cta"], copyStatus: "drafted" }),
        },
      ],
    ]);

    const parsed = JSON.parse(toJson(pages, details));

    expect(parsed.pages[0].sectionsMeta).toEqual([
      { title: "Hero", copyStatus: "drafted", keywords: ["welcome", "cta"] },
    ]);
  });

  it("does not add sectionsMeta when no details map is supplied", () => {
    const pages: BoardPage[] = [
      page({
        pageSlug: "about",
        sections: [{ id: "s1", title: "Hero", kind: "static", position: 0, component: null }],
      }),
    ];
    const parsed = JSON.parse(toJson(pages));
    expect(parsed.pages[0].sectionsMeta).toBeUndefined();
  });

  // F029, AS-104: filtering the JSON export by pageSlug returns only that
  // page's sections, including that page's section meta -- not every page.
  it("test_AS_104_pageslug_filter_returns_only_that_pages_sections_with_meta", () => {
    const pages: BoardPage[] = [
      page({
        pageSlug: "home",
        title: "Home",
        sections: [{ id: "h1", title: "Hero", kind: "static", position: 0, component: null }],
      }),
      page({
        pageSlug: "about",
        title: "About",
        sections: [{ id: "a1", title: "Team", kind: "static", position: 0, component: null }],
      }),
    ];
    const details: ArchitectureNodeDetails = new Map([
      ["h1", { estimates: [], meta: meta({ keywords: ["welcome"], copyStatus: "approved" }) }],
      ["a1", { estimates: [], meta: meta({ keywords: ["team-bio"], copyStatus: "approved" }) }],
    ]);

    const parsed = JSON.parse(toJson(pages, details, { pageSlug: "home" }));

    expect(parsed.pages).toHaveLength(1);
    expect(parsed.pages[0].path).toBe("home");
    expect(parsed.pages[0].sections).toEqual(["Hero"]);
    expect(parsed.pages[0].sectionsMeta).toEqual([
      { title: "Hero", copyStatus: "approved", keywords: ["welcome"] },
    ]);
  });

  it("AS-036: a listing page (a CMS section) is recognised via hasCmsSections: true", () => {
    const pages: BoardPage[] = [
      page({
        pageSlug: "blogg",
        title: "Blogg",
        sections: [
          { id: "1", title: "Feed", kind: "cms", position: 0, component: null },
        ],
      }),
    ];
    const parsed = JSON.parse(toJson(pages));
    expect(parsed.pages[0].hasCmsSections).toBe(true);
  });

  it("AS-036: a static page with no CMS sections carries no hasCmsSections key", () => {
    const pages: BoardPage[] = [
      page({
        pageSlug: "about",
        title: "About",
        sections: [
          { id: "1", title: "Hero", kind: "static", position: 0, component: null },
        ],
      }),
    ];
    const parsed = JSON.parse(toJson(pages));
    expect(parsed.pages[0]).not.toHaveProperty("hasCmsSections");
  });

  it("AS-036: a page with multiple non-CMS sections still carries no hasCmsSections key", () => {
    const pages: BoardPage[] = [
      page({
        pageSlug: "landing",
        title: "Landing",
        sections: [
          { id: "1", title: "Hero", kind: "static", position: 0, component: null },
          { id: "2", title: "Features", kind: "static", position: 1, component: null },
          { id: "3", title: "Footer", kind: "static", position: 2, component: null },
        ],
      }),
    ];
    const parsed = JSON.parse(toJson(pages));
    expect(parsed.pages[0]).not.toHaveProperty("hasCmsSections");
  });

  it("AS-037: hasCmsSections key is present (true) iff page has >=1 section with kind='cms', absent otherwise", () => {
    const pages: BoardPage[] = [
      page({ pageSlug: "no-sections", sections: [] }),
      page({
        pageSlug: "static-only",
        sections: [
          { id: "1", title: "Hero", kind: "static", position: 0, component: null },
        ],
      }),
      page({
        pageSlug: "has-cms",
        sections: [
          { id: "1", title: "Hero", kind: "static", position: 0, component: null },
          { id: "2", title: "Feed", kind: "cms", position: 1, component: null },
        ],
      }),
    ];
    const parsed = JSON.parse(toJson(pages));
    const byPath = Object.fromEntries(
      parsed.pages.map((p: { path: string; hasCmsSections?: boolean }) => [p.path, p.hasCmsSections]),
    );
    expect(byPath["no-sections"]).toBeUndefined();
    expect(byPath["static-only"]).toBeUndefined();
    expect(byPath["has-cms"]).toBe(true);
  });
});

describe("F010 regression: non-CMS export byte-compatibility", () => {
  const NON_CMS_PAGES: BoardPage[] = [
    page({ pageSlug: "", title: "Home", position: 0 }),
    page({
      pageSlug: "about",
      title: "About",
      position: 1,
      sections: [
        { id: "1", title: "Hero", kind: "static", position: 0, component: null },
        { id: "2", title: "Grid", kind: "static", position: 1, component: null },
      ],
    }),
    page({ pageSlug: "about/team", title: "Team", position: 2 }),
  ];

  it("AS-038: a page with only static sections is byte-identical to the pre-F009 JSON shape", () => {
    const output = toJson(NON_CMS_PAGES);

    // Non-CMS pages must never carry a hasCmsSections key at all -- the
    // output must be byte-identical to the pre-F009 shape, not "the old
    // shape plus an extra field".
    const expected = JSON.stringify(
      {
        version: 1,
        pages: [
          { path: "", title: "Home", kind: "static", sections: [] },
          { path: "about", title: "About", kind: "static", sections: ["Hero", "Grid"] },
          { path: "about/team", title: "Team", kind: "static", sections: [] },
        ],
      },
      null,
      2,
    );

    expect(output).toEqual(expected);

    const parsed = JSON.parse(output);
    for (const entry of parsed.pages) {
      expect(entry).not.toHaveProperty("hasCmsSections");
    }
  });

  it("AS-039: markdown export is unchanged for pages without CMS sections", () => {
    const markdown = toMarkdown(NON_CMS_PAGES);

    // toMarkdown never reads section kind or the hasCmsSections flag at
    // all -- it only walks the page tree by path/title -- so F009 could not
    // have altered its output for any page, CMS or not.
    expect(markdown.split("\n")).toEqual([
      "- Home ``",
      "  - About `about`",
      "    - Team `about/team`",
    ]);
    expect(markdown).not.toMatch(/hasCmsSections|cms/i);
  });

  it("AS-038/AS-039: CSV and XML exports are likewise untouched by hasCmsSections for non-CMS pages", () => {
    // Sibling exports (toCsv, toSitemapXml) never mention sections' kind or
    // hasCmsSections either -- guard against regressions creeping into the
    // shared BoardPage shape leaking into unrelated export formats.
    const csv = toCsv(NON_CMS_PAGES);
    const xml = toSitemapXml(NON_CMS_PAGES, "https://example.com");
    expect(csv).not.toMatch(/hasCmsSections/i);
    expect(xml).not.toMatch(/hasCmsSections/i);
  });
});

describe("parseSitemap text input", () => {
  it("accepts bare and slash-prefixed paths", () => {
    const result = parseSitemap("/about\ncontact\nhttps://example.com/legal?x=1#y");
    expect(result.ok && result.pages).toEqual([
      { path: "about", title: "About" },
      { path: "contact", title: "Contact" },
      { path: "legal", title: "Legal" },
    ]);
  });

  it("derives paths from indentation when bullets have no explicit path", () => {
    const result = parseSitemap("- About\n  - Our Team\n- Contact Us");
    expect(result.ok && result.pages.map((entry) => entry.path)).toEqual([
      "about",
      "about/our-team",
      "contact-us",
    ]);
  });

  it("prefers the backticked path over the derived one", () => {
    const result = parseSitemap("- About `om-oss`\n  - Team");
    expect(result.ok && result.pages).toEqual([
      { path: "om-oss", title: "About" },
      { path: "om-oss/team", title: "Team" },
    ]);
  });

  it("synthesises missing ancestors before their descendants", () => {
    const result = parseSitemap("a/b/c");
    expect(result.ok && result.pages).toEqual([
      { path: "a", title: "A" },
      { path: "a/b", title: "B" },
      { path: "a/b/c", title: "C" },
    ]);
  });

  it("drops duplicates, keeping the first occurrence", () => {
    const result = parseSitemap("/About\nabout\n/about/");
    expect(result.ok && result.pages).toEqual([{ path: "about", title: "About" }]);
  });

  it("skips asset and feed extensions", () => {
    const result = parseSitemap("about\nlogo.png\nfeed.xml\napp.js");
    expect(result.ok && result.pages.map((entry) => entry.path)).toEqual(["about"]);
  });

  it("decodes percent-encoding and lowercases", () => {
    const result = parseSitemap("/Our%20Services");
    expect(result.ok && result.pages).toEqual([
      { path: "our-services", title: "Our Services" },
    ]);
  });
});

describe("parseSitemap failure branches", () => {
  it("rejects empty input", () => {
    expect(parseSitemap("   ")).toEqual({ ok: false, error: "Input was empty." });
  });

  it("rejects XML without a urlset", () => {
    const result = parseSitemap("<rss><channel/></rss>");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatch(/urlset/);
  });

  it("rejects a urlset with no url entries", () => {
    const result = parseSitemap('<urlset xmlns="x"></urlset>');
    expect(!result.ok && result.error).toMatch(/no <url> entries/);
  });

  it("rejects a urlset whose locs are all empty", () => {
    const result = parseSitemap("<urlset ><url><loc>  </loc></url></urlset>");
    expect(!result.ok && result.error).toMatch(/no usable <loc>/);
  });

  it("rejects malformed JSON", () => {
    const result = parseSitemap("{ oops");
    expect(!result.ok && result.error).toMatch(/could not be parsed/);
  });

  it("rejects JSON without a pages array", () => {
    const result = parseSitemap('{"version":1}');
    expect(!result.ok && result.error).toMatch(/`pages` array/);
  });

  it("rejects JSON whose entries have no path", () => {
    const result = parseSitemap('{"version":1,"pages":[{"title":"x"}]}');
    expect(!result.ok && result.error).toMatch(/no usable page entries/);
  });

  it("rejects text that yields nothing usable", () => {
    const result = parseSitemap("!!!\n???");
    expect(!result.ok && result.error).toMatch(/No page paths/);
  });

  it("never throws on hostile input", () => {
    expect(() => parseSitemap("%%%\n<urlset><url><loc>%E0%A4%A</loc></url></urlset>")).not.toThrow();
  });
});
