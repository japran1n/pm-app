// F020 (AS-016, AS-017): the project detail layout streams the heavy
// rollups (hours line, per-person estimate rollup, link strip) behind
// their own Suspense boundaries, instead of blocking the header
// (breadcrumb/name/tabs) on all three round trips.
//
// Rendering this file with React Testing Library would require mocking
// every Supabase query it touches plus Suspense/streaming semantics that
// don't resolve meaningfully under jsdom's synchronous render. Per the
// project's existing pattern for server-only layout files (see
// f010-create-page-action.test.ts and friends), this is verified at the
// source level: the JSX the layout returns must place the project row
// (breadcrumb/title/tabs) outside of any Suspense boundary, and each heavy
// rollup must be wrapped in its own <Suspense> so React can flush the
// header before those resolve.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(
    __dirname,
    "../../app/(workspace)/w/[workspaceSlug]/projects/[projectId]/layout.tsx",
  ),
  "utf8",
);

describe("F020: project layout streams its rollups", () => {
  it("AS-016: renders the header (breadcrumb, name, tabs) from data available after just the project row, not gated behind Promise.all of the rollups", () => {
    // Only one await stands between `params` and the JSX return: the
    // project row lookup. No Promise.all of timeTotals/personRollup/links
    // blocks the return anymore.
    expect(source).not.toMatch(/Promise\.all\(\s*\[\s*getProjectTimeTotals/);

    // The header markup (breadcrumb + title + tabs) still lives in the
    // layout body, unconditionally rendered.
    expect(source).toContain("<ProjectBreadcrumb");
    expect(source).toContain("<ProjectTabs");
    expect(source).toContain("project.name");
  });

  it("AS-017: the hours line, per-person estimate rollup, and link strip each move behind their own Suspense boundary", () => {
    // Three independent async components, each doing exactly one of the
    // three heavy reads, each wrapped in its own <Suspense>.
    expect(source).toMatch(
      /async function TimeRollup[\s\S]*getProjectTimeTotals/,
    );
    expect(source).toMatch(
      /async function PersonRollup[\s\S]*getProjectEstimateAndLoggedByPerson/,
    );
    expect(source).toMatch(/async function LinkStrip[\s\S]*getProjectLinks/);

    const suspenseCount = (source.match(/<Suspense/g) ?? []).length;
    expect(suspenseCount).toBe(3);

    expect(source).toMatch(/<Suspense[\s\S]*?>\s*<TimeRollup/);
    expect(source).toMatch(/<Suspense[\s\S]*?>\s*<PersonRollup/);
    expect(source).toMatch(/<Suspense[\s\S]*?>\s*<LinkStrip/);
  });

  it("AS-025 (no-behaviour-change guard): the same three data sources and rendered components are still present, just relocated", () => {
    expect(source).toContain("getProjectTimeTotals");
    expect(source).toContain("getProjectEstimateAndLoggedByPerson");
    expect(source).toContain("getProjectLinks");
    expect(source).toContain("resolvePeople");
    expect(source).toContain("<PersonEstimateRollup");
    expect(source).toContain("<ProjectLinkStrip");
  });
});
