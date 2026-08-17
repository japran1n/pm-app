import { describe, expect, it } from "vitest";

import { requiresAuth } from "@/proxy";

describe("requiresAuth (AS-001: unauthenticated visitor to /w/* is redirected to sign-in)", () => {
  it("AS-001: requires auth for a workspace-scoped route", () => {
    expect(requiresAuth("/w/test-workspace")).toBe(true);
  });

  it("AS-001: requires auth for nested workspace-scoped routes", () => {
    expect(requiresAuth("/w/test-workspace/projects/123/board")).toBe(true);
  });

  it("AS-001: requires auth for the bare /w path", () => {
    expect(requiresAuth("/w")).toBe(true);
  });

  it("AS-001: does not require auth for the home page", () => {
    expect(requiresAuth("/")).toBe(false);
  });

  it("AS-001: does not require auth for the sign-in page itself", () => {
    expect(requiresAuth("/sign-in")).toBe(false);
  });

  it("AS-001: does not require auth for paths that merely start with 'w' but aren't workspace-scoped", () => {
    expect(requiresAuth("/wildcard")).toBe(false);
  });
});
