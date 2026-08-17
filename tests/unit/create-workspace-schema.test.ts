import { describe, expect, it } from "vitest";

import { createWorkspaceSchema, slugify } from "@/lib/validation/workspaces";

describe("createWorkspaceSchema (AS-006: creating a workspace requires a name)", () => {
  it("AS-006: accepts a well-formed name and trims whitespace", () => {
    const result = createWorkspaceSchema.safeParse({ name: "  Acme Inc.  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Acme Inc.");
    }
  });

  it("AS-006: rejects an empty name", () => {
    const result = createWorkspaceSchema.safeParse({ name: "" });
    expect(result.success).toBe(false);
  });

  it("AS-006: rejects a name that is only whitespace", () => {
    const result = createWorkspaceSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("AS-006: rejects an unreasonably long name", () => {
    const result = createWorkspaceSchema.safeParse({ name: "x".repeat(81) });
    expect(result.success).toBe(false);
  });

  it("AS-146: rejects non-string input instead of hitting the database", () => {
    const result = createWorkspaceSchema.safeParse({ name: 12345 });
    expect(result.success).toBe(false);
  });
});

describe("slugify (AS-006: workspace gets a URL-safe slug derived from its name)", () => {
  it("lowercases and hyphenates a normal name", () => {
    expect(slugify("Acme Inc.")).toBe("acme-inc");
  });

  it("collapses repeated non-alphanumeric characters into a single hyphen", () => {
    expect(slugify("My   Team!!")).toBe("my-team");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("--Acme--")).toBe("acme");
  });

  it("falls back to a default slug when the name has no URL-safe characters", () => {
    expect(slugify("!!!")).toBe("workspace");
  });
});
