// Contract test for extensionCreateTaskSchema (P2-5).
//
// The extension/ directory runs in its own tsconfig/eslint context and is
// excluded from the main Next.js tsconfig — so shape regressions in the
// shared lib/validation/extension.ts module can go unnoticed until the
// extension itself is type-checked. This file ensures the schema's
// minimum required shape is verified as part of the main unit suite.
//
// It does NOT import from the extension package itself (a separate workspace
// with its own node_modules) — the schema lives in lib/validation/extension.ts
// and is imported directly by app/api/extension/tasks/route.ts, so the
// main project already owns it. Checking the schema's shape here is the
// correct contract boundary: the extension route has a typed dependency on
// this exact export; if the shape breaks, this test breaks.

import { describe, expect, it } from "vitest";
import { extensionCreateTaskSchema } from "@/lib/validation/extension";

describe("extensionCreateTaskSchema contract (P2-5)", () => {
  it("is exported from lib/validation/extension", () => {
    expect(typeof extensionCreateTaskSchema).toBe("object");
  });

  it("accepts a minimal valid payload (projectId + title only)", () => {
    const result = extensionCreateTaskSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001",
      title: "Bug: button does not submit",
    });
    expect(result.success).toBe(true);
  });

  it("accepts a fully-populated payload", () => {
    const result = extensionCreateTaskSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001",
      title: "Bug: button does not submit",
      description: "Steps to reproduce…",
      status: "in_progress",
      priority: "high",
      assigneeId: "00000000-0000-4000-8000-000000000002",
      dueDate: "2026-12-31",
      taskTypeId: "00000000-0000-4000-8000-000000000003",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload with a missing title", () => {
    const result = extensionCreateTaskSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a payload with an invalid projectId", () => {
    const result = extensionCreateTaskSchema.safeParse({
      projectId: "not-a-uuid",
      title: "Bug",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a per-project (v2) status name", () => {
    const result = extensionCreateTaskSchema.safeParse({
      projectId: "00000000-0000-4000-8000-000000000001",
      title: "Bug",
      status: "QA by Dev",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty or over-long status", () => {
    for (const status of ["   ", "x".repeat(101)]) {
      const result = extensionCreateTaskSchema.safeParse({
        projectId: "00000000-0000-4000-8000-000000000001",
        title: "Bug",
        status,
      });
      expect(result.success).toBe(false);
    }
  });

  it("has the expected top-level keys", () => {
    // Verify the schema shape has all the fields documented in its comment.
    // `extensionCreateTaskSchema.shape` is a Zod object's internal property
    // map — checking its keys guards against accidental field removal.
    const shape = extensionCreateTaskSchema.shape;
    expect(shape).toHaveProperty("projectId");
    expect(shape).toHaveProperty("title");
    expect(shape).toHaveProperty("description");
    expect(shape).toHaveProperty("status");
    expect(shape).toHaveProperty("priority");
    expect(shape).toHaveProperty("assigneeId");
    expect(shape).toHaveProperty("dueDate");
    expect(shape).toHaveProperty("taskTypeId");
  });
});
