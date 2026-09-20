import { describe, expect, it } from "vitest";

import { changePageSlugSchema } from "@/lib/validation/architecture";

// Mission 20260919-150607, F041 (AS-139, AS-140). AS-141 (slug uniqueness
// among sibling pages) is a server-side check implemented in the
// changePageSlug action (F042); it is not testable at the schema level and
// is covered by F042/F043's own tests instead.

describe("changePageSlugSchema", () => {
  it("AS-139: parses a valid uuid taskId with a simple slug", () => {
    const result = changePageSlugSchema.safeParse({
      taskId: "123e4567-e89b-12d3-a456-426614174000",
      slug: "my-page",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("my-page");
    }
  });

  it("AS-139: parses a valid nested slug with forward slashes", () => {
    const result = changePageSlugSchema.safeParse({
      taskId: "123e4567-e89b-12d3-a456-426614174000",
      slug: "services/seo",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.slug).toBe("services/seo");
    }
  });

  it("AS-140: rejects an empty slug", () => {
    const result = changePageSlugSchema.safeParse({
      taskId: "123e4567-e89b-12d3-a456-426614174000",
      slug: "",
    });

    expect(result.success).toBe(false);
  });

  it("AS-140: rejects a slug longer than 200 characters", () => {
    const longSlug = "a".repeat(201);
    const result = changePageSlugSchema.safeParse({
      taskId: "123e4567-e89b-12d3-a456-426614174000",
      slug: longSlug,
    });

    expect(result.success).toBe(false);
  });

  it("AS-140: accepts a slug at exactly 200 characters", () => {
    const boundarySlug = "a".repeat(200);
    const result = changePageSlugSchema.safeParse({
      taskId: "123e4567-e89b-12d3-a456-426614174000",
      slug: boundarySlug,
    });

    expect(result.success).toBe(true);
  });

  it("AS-140: rejects a slug with uppercase letters", () => {
    const result = changePageSlugSchema.safeParse({
      taskId: "123e4567-e89b-12d3-a456-426614174000",
      slug: "My-Page",
    });

    expect(result.success).toBe(false);
  });

  it("AS-140: rejects a slug with spaces", () => {
    const result = changePageSlugSchema.safeParse({
      taskId: "123e4567-e89b-12d3-a456-426614174000",
      slug: "my page",
    });

    expect(result.success).toBe(false);
  });

  it("AS-140: rejects an invalid taskId that is not a uuid", () => {
    const result = changePageSlugSchema.safeParse({
      taskId: "not-a-uuid",
      slug: "my-page",
    });

    expect(result.success).toBe(false);
  });
});
