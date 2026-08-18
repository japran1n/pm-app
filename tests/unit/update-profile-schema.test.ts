// Unit test for F123's `updateProfileSchema` (AS-202), specifically the
// timezone-validity check. Pure Zod parsing, no Supabase — the
// action-level integration test (tests/integration/update-profile.test.ts)
// exercises the full Server Action against the real project.

import { describe, expect, it } from "vitest";

import { updateProfileSchema } from "@/lib/validation/profile";

describe("test_AS_202_update_profile_schema", () => {
  it("accepts a real IANA zone name from Intl.supportedValuesOf", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "Ada Lovelace",
      timezone: "America/New_York",
    });
    expect(result.success).toBe(true);
  });

  it("accepts 'UTC' — the literal string F120's profiles.timezone column defaults every row to, which Intl.supportedValuesOf('timeZone') itself does NOT list (only 'Etc/UTC')", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "Ada Lovelace",
      timezone: "UTC",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a string that isn't a real timezone identifier", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "Ada Lovelace",
      timezone: "Not/A_Real_Zone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty/whitespace-only display name", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "   ",
      timezone: "UTC",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a display name over 80 characters", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "a".repeat(81),
      timezone: "UTC",
    });
    expect(result.success).toBe(false);
  });

  it("trims a display name with leading/trailing whitespace", () => {
    const result = updateProfileSchema.safeParse({
      displayName: "  Ada Lovelace  ",
      timezone: "UTC",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.displayName).toBe("Ada Lovelace");
    }
  });
});
