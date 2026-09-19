// F035 (AS-119, AS-120): `description_text` must never be re-added to a
// `page_components`/`tasks` SELECT list for the architecture board, and must
// never render in the architecture board UI again. Structural/grep-based
// regression: fails the moment either comes back, regardless of *how* it's
// reintroduced (raw string literal, template literal, or JSX).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ARCHITECTURE_QUERIES_FILE = join(process.cwd(), "lib/queries/architecture.ts");
const PAGE_COLUMN_FILE = join(process.cwd(), "components/architecture/page-column.tsx");
const CLIENT_PAGE_COLUMN_FILE = join(
  process.cwd(),
  "components/architecture/client-page-column.tsx",
);

describe("F035 AS-120: description_text is never loaded in architecture board queries", () => {
  it("lib/queries/architecture.ts never selects description_text", () => {
    const source = readFileSync(ARCHITECTURE_QUERIES_FILE, "utf-8");

    expect(source).not.toMatch(/description_text/);
  });
});

describe("F035 AS-119: description_text is never rendered on the architecture board", () => {
  it("the team-side page column component has no description_text/page.description reference", () => {
    const source = readFileSync(PAGE_COLUMN_FILE, "utf-8");

    expect(source).not.toMatch(/description_text/);
    expect(source).not.toMatch(/page\.description\b/);
  });

  it("the client/portal page column component has no description_text/page.description reference", () => {
    const source = readFileSync(CLIENT_PAGE_COLUMN_FILE, "utf-8");

    expect(source).not.toMatch(/description_text/);
    expect(source).not.toMatch(/page\.description\b/);
  });
});
