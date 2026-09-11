// F043 (AS-169): the board and the brief are presented as separate portal
// views -- distinct routes, not tabs within a single page. Rendering these
// server components would require mocking Supabase queries, auth,
// next/navigation params, and the questionnaire's client-side form stack
// for no payoff over reading the actual page files: the assertion under
// test is about route/file separation and each page's own content
// exclusivity, both of which are fully determined by source.
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const portalProjectDir = path.join(
  process.cwd(),
  "app",
  "(portal)",
  "portal",
  "[workspaceSlug]",
  "p",
  "[projectId]",
);

const architecturePagePath = path.join(portalProjectDir, "architecture", "page.tsx");
const briefPagePath = path.join(portalProjectDir, "brief", "page.tsx");

describe("F043: architecture board and brief are separate portal views", () => {
  it("test_AS_169_architecture_and_brief_are_distinct_route_files", () => {
    expect(existsSync(architecturePagePath)).toBe(true);
    expect(existsSync(briefPagePath)).toBe(true);
    expect(architecturePagePath).not.toBe(briefPagePath);
  });

  it("test_AS_169_architecture_page_renders_without_brief_content", () => {
    const source = readFileSync(architecturePagePath, "utf8");
    // No brief-specific data source, component, or questionnaire import --
    // the architecture route never pulls in the brief's rendering surface.
    expect(source).not.toContain("getBriefForClient");
    expect(source).not.toContain("PortalQuestionnaire");
    expect(source.toLowerCase()).not.toContain("questionnaire");
    // It does render its own board content.
    expect(source).toContain("ClientArchitectureBoard");
    expect(source).toContain("getArchitectureBoardForClient");
  });

  it("test_AS_169_brief_page_renders_without_architecture_content", () => {
    const source = readFileSync(briefPagePath, "utf8");
    // No architecture-board data source or component imported into the
    // brief route.
    expect(source).not.toContain("getArchitectureBoardForClient");
    expect(source).not.toContain("ClientArchitectureBoard");
    expect(source.toLowerCase()).not.toContain("architecture board");
    // It does render its own questionnaire content.
    expect(source).toContain("PortalQuestionnaire");
    expect(source).toContain("getBriefForClient");
  });

  it("test_AS_169_no_tab_switcher_couples_the_two_views_into_one_page", () => {
    const architectureSource = readFileSync(architecturePagePath, "utf8");
    const briefSource = readFileSync(briefPagePath, "utf8");
    // Neither route file imports a shared tabs component that would
    // indicate the two are actually one page switching between panels.
    for (const source of [architectureSource, briefSource]) {
      expect(source.toLowerCase()).not.toContain("tabslist");
      expect(source.toLowerCase()).not.toContain("tabstrigger");
    }
  });
});
