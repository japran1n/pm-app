import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// F032 (missions/20260919-150607, AS-112/113/114): page_components.description
// had 0 non-null rows (confirmed by F031) and was dropped. This is a static
// source check -- no DB round trip -- so it fails immediately if `description`
// ever reappears in a page_components SELECT or in the BoardComponent shape.
const architectureQuerySource = readFileSync(
  path.join(__dirname, "architecture.ts"),
  "utf-8",
);

describe("AS-113: no query selects description from page_components", () => {
  it("architecture.ts selects page_components via the COMPONENT_COLUMNS constant", () => {
    const selectCallCount = (
      architectureQuerySource.match(/\.select\(\s*COMPONENT_COLUMNS\s*\)/g) ?? []
    ).length;
    expect(selectCallCount).toBeGreaterThan(0);
  });

  it("COMPONENT_COLUMNS constant does not reference description", () => {
    const constMatch = architectureQuerySource.match(
      /const COMPONENT_COLUMNS = "([^"]*)"/,
    );
    expect(constMatch).not.toBeNull();
    const columns = (constMatch?.[1] ?? "").split(",").map((c) => c.trim());
    expect(columns).not.toContain("description");
  });

  it("no other .select(...) call anywhere in architecture.ts includes a literal description column", () => {
    const inlineSelectCalls = [
      ...architectureQuerySource.matchAll(/\.select\(\s*"([^"]*)"\s*\)/g),
    ].map((m) => m[1]);
    for (const columns of inlineSelectCalls) {
      expect(columns.split(",").map((c) => c.trim())).not.toContain(
        "description",
      );
    }
  });
});

describe("AS-114: TypeScript types no longer include description on PageComponent/BoardComponent", () => {
  it("BoardComponent type declaration does not declare a description field", () => {
    const typeMatch = architectureQuerySource.match(
      /export type BoardComponent = \{[\s\S]*?\};/,
    );
    expect(typeMatch).not.toBeNull();
    expect(typeMatch?.[0]).not.toMatch(/description\s*\?\s*:/);
  });

  it("ComponentRow type declaration does not declare a description field", () => {
    const typeMatch = architectureQuerySource.match(
      /type ComponentRow = \{[\s\S]*?\};/,
    );
    expect(typeMatch).not.toBeNull();
    expect(typeMatch?.[0]).not.toMatch(/description\s*\?\s*:/);
  });

  it("generated database types no longer declare page_components.description", () => {
    const dbTypesSource = readFileSync(
      path.join(__dirname, "..", "supabase", "database.types.ts"),
      "utf-8",
    );
    const pageComponentsMatch = dbTypesSource.match(
      /page_components:\s*\{[\s\S]*?\n\s{6}\}\n/,
    );
    expect(pageComponentsMatch).not.toBeNull();
    expect(pageComponentsMatch?.[0]).not.toMatch(/description\s*:/);
  });
});

describe("AS-112: migration dropping page_components.description exists", () => {
  it("a migration file drops the description column from page_components", () => {
    const migrationsDir = path.join(__dirname, "..", "..", "supabase", "migrations");
    const files: string[] = readdirSync(migrationsDir);
    const match = files.find(
      (f) => f.includes("drop_page_components_description") && f.endsWith(".sql"),
    );
    expect(match).toBeDefined();
    const sql = readFileSync(path.join(migrationsDir, match as string), "utf-8");
    expect(sql).toMatch(/drop column if exists description/i);
    expect(sql).toMatch(/page_components/);
  });
});
