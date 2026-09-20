import { describe, it, expect } from "vitest";
import { createPageSchema } from "@/lib/validation/architecture";

describe("F046 createPage page_kind optional (AS-155, AS-156)", () => {
  it("AS-156: createPageSchema parses input without page_kind", () => {
    const result = createPageSchema.safeParse({
      name: "My Page",
      slug: "my-page",
      // no page_kind
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page_kind).toBe("static");
    }
  });

  it("AS-155: createPageSchema succeeds without page_kind and defaults to static", () => {
    const result = createPageSchema.safeParse({
      name: "My Page",
      slug: "my-page",
      // no page_kind supplied
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page_kind).toBe("static");
    }
  });
});
