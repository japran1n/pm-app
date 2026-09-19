// Unit coverage for lib/architecture/sitemap-io.ts -- pure string in/out,
// so the export formats and the importer's normalisation are provable
// without a DB, a DOM, or an XML parser dependency.

import { describe, expect, it } from "vitest";
import type { BoardPage } from "@/lib/queries/architecture";
import {
  parseSitemap,
  toCsv,
  toJson,
  toMarkdown,
  toSitemapXml,
} from "@/lib/architecture/sitemap-io";

function page(overrides: Partial<BoardPage> & { pageSlug: string }): BoardPage {
  return {
    id: overrides.pageSlug || "root",
    title: overrides.title ?? "Untitled",
    pageSlug: overrides.pageSlug,
    pageKind: overrides.pageKind ?? "static",
    position: overrides.position ?? 0,
    description: null,
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

  it("AS-036: exported page object has a hasCmsSections field", () => {
    const parsed = JSON.parse(toJson(PAGES));
    for (const page of parsed.pages) {
      expect(page).toHaveProperty("hasCmsSections");
      expect(typeof page.hasCmsSections).toBe("boolean");
    }
  });

  it("AS-037: hasCmsSections is true iff page has >=1 section with kind='cms'", () => {
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
      parsed.pages.map((p: { path: string; hasCmsSections: boolean }) => [p.path, p.hasCmsSections]),
    );
    expect(byPath["no-sections"]).toBe(false);
    expect(byPath["static-only"]).toBe(false);
    expect(byPath["has-cms"]).toBe(true);
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
