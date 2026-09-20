// F079 (AS-011): source guard against a local `weekHrefFor` closure in
// page.tsx re-deriving nav hrefs and gaming the F029 test suite. page.tsx
// must call `buildPlannerNavHrefs` from lib/calendar/week-nav.ts exactly
// once and must not define a `weekHrefFor` closure of its own.
//
// This test reads the source text directly (not the compiled behaviour)
// because the bug this guards against is structural: a second, parallel
// implementation of the href-building logic living in page.tsx itself,
// which would let a mutation inside `buildPlannerNavHrefs` (e.g. dropping
// `peopleParam`) pass silently as long as the closure's own copy still
// carried it forward.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  join(process.cwd(), "app/(workspace)/w/[workspaceSlug]/calendar/page.tsx"),
  "utf8",
);

describe("AS-011: calendar page.tsx has a single buildPlannerNavHrefs call site", () => {
  it("does not define a weekHrefFor closure", () => {
    expect(pageSource).not.toMatch(/weekHrefFor/);
  });

  it("calls buildPlannerNavHrefs exactly once", () => {
    const calls = pageSource.match(/buildPlannerNavHrefs\s*\(/g) ?? [];
    expect(calls.length).toBe(1);
  });

  it("imports buildPlannerNavHrefs from lib/calendar/week-nav", () => {
    expect(pageSource).toMatch(
      /import\s*\{\s*buildPlannerNavHrefs\s*\}\s*from\s*["']@\/lib\/calendar\/week-nav["']/,
    );
  });
});
