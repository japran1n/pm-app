import { describe, expect, it } from "vitest";

import { createProjectSchema } from "@/lib/validation/projects";

const workspaceId = "11111111-1111-4111-8111-111111111111";

describe("createProjectSchema (AS-025, AS-026, AS-035)", () => {
  it("AS-025: accepts a name-only submission (description/dates optional)", () => {
    const result = createProjectSchema.safeParse({
      workspaceId,
      name: "Website Relaunch",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Website Relaunch");
    }
  });

  it("AS-025: accepts a name plus optional description", () => {
    const result = createProjectSchema.safeParse({
      workspaceId,
      name: "Website Relaunch",
      description: "Q3 marketing site rebuild",
    });
    expect(result.success).toBe(true);
  });

  it("AS-026: rejects an empty name", () => {
    const result = createProjectSchema.safeParse({ workspaceId, name: "" });
    expect(result.success).toBe(false);
  });

  it("AS-026: rejects a name that is only whitespace", () => {
    const result = createProjectSchema.safeParse({ workspaceId, name: "   " });
    expect(result.success).toBe(false);
  });

  it("AS-146: rejects a missing workspaceId instead of hitting the database", () => {
    const result = createProjectSchema.safeParse({ name: "No workspace" });
    expect(result.success).toBe(false);
  });

  it("AS-035: accepts end_date equal to start_date", () => {
    const result = createProjectSchema.safeParse({
      workspaceId,
      name: "Same day",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
    });
    expect(result.success).toBe(true);
  });

  it("AS-035: accepts end_date after start_date", () => {
    const result = createProjectSchema.safeParse({
      workspaceId,
      name: "Valid range",
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
    expect(result.success).toBe(true);
  });

  it("AS-035: rejects end_date earlier than start_date", () => {
    const result = createProjectSchema.safeParse({
      workspaceId,
      name: "Invalid range",
      startDate: "2026-09-30",
      endDate: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });

  it("AS-035: allows start_date with no end_date", () => {
    const result = createProjectSchema.safeParse({
      workspaceId,
      name: "Only start",
      startDate: "2026-09-01",
    });
    expect(result.success).toBe(true);
  });

  it("AS-035: allows end_date with no start_date", () => {
    const result = createProjectSchema.safeParse({
      workspaceId,
      name: "Only end",
      endDate: "2026-09-30",
    });
    expect(result.success).toBe(true);
  });
});
