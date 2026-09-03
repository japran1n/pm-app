// F004 (missions/20260903-portal, AS-015, AS-016): validates the two new
// `updateColumnSchema` fields in isolation, since they're the boundary
// between the settings screen's "Auto"/empty-string UI values and what
// actually lands in `project_statuses.client_description`/
// `client_bucket`.
import { describe, expect, it } from "vitest";

import { updateColumnSchema } from "@/lib/validation/statuses";

const BASE = {
  columnId: "11111111-1111-4111-8111-111111111111",
  name: "Awaiting Client Feedback",
  color: "#64748b",
  category: "in_progress",
};

describe("updateColumnSchema — client description (AS-016)", () => {
  it("test_AS_016_a_real_description_is_trimmed_and_kept", () => {
    const result = updateColumnSchema.safeParse({
      ...BASE,
      clientDescription: "  Look at this and approve it.  ",
      clientBucket: "auto",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientDescription).toBe("Look at this and approve it.");
    }
  });

  it("test_AS_016_an_empty_description_normalises_to_null_rather_than_an_empty_string", () => {
    const result = updateColumnSchema.safeParse({
      ...BASE,
      clientDescription: "   ",
      clientBucket: "auto",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientDescription).toBeNull();
    }
  });

  it("test_AS_016_a_description_over_500_characters_is_rejected", () => {
    const result = updateColumnSchema.safeParse({
      ...BASE,
      clientDescription: "x".repeat(501),
      clientBucket: "auto",
    });
    expect(result.success).toBe(false);
  });

  it("test_AS_016_clientDescription_may_be_omitted_entirely_leaving_the_field_untouched", () => {
    // Every pre-F004 caller of `updateColumn` (several integration
    // tests) never sends this field at all.
    const result = updateColumnSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientDescription).toBeUndefined();
    }
  });
});

describe("updateColumnSchema — client bucket override (AS-015)", () => {
  it.each(["waiting", "progress", "blocked", "done"])(
    "test_AS_015_%s_is_a_valid_explicit_bucket",
    (bucket) => {
      const result = updateColumnSchema.safeParse({
        ...BASE,
        clientDescription: "",
        clientBucket: bucket,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.clientBucket).toBe(bucket);
      }
    },
  );

  it("test_AS_015_auto_normalises_to_null_clearing_any_override", () => {
    const result = updateColumnSchema.safeParse({
      ...BASE,
      clientDescription: "",
      clientBucket: "auto",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientBucket).toBeNull();
    }
  });

  it("test_AS_015_an_unrecognised_bucket_value_is_rejected", () => {
    const result = updateColumnSchema.safeParse({
      ...BASE,
      clientDescription: "",
      clientBucket: "urgent",
    });
    expect(result.success).toBe(false);
  });

  it("test_AS_015_clientBucket_may_be_omitted_entirely_leaving_the_field_untouched", () => {
    const result = updateColumnSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientBucket).toBeUndefined();
    }
  });
});
