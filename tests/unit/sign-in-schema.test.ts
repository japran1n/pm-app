import { describe, expect, it } from "vitest";

import { signInSchema } from "@/lib/validation/auth";

describe("signInSchema (AS-002: user can request a magic link with a valid email)", () => {
  it("AS-002: accepts a well-formed email and trims whitespace", () => {
    const result = signInSchema.safeParse({ email: "  user@example.com  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("AS-002: rejects a malformed email so the magic-link request is never sent", () => {
    const result = signInSchema.safeParse({ email: "not-an-email" });
    expect(result.success).toBe(false);
  });

  it("AS-002: rejects an empty email", () => {
    const result = signInSchema.safeParse({ email: "" });
    expect(result.success).toBe(false);
  });

  it("AS-146: rejects non-string input instead of hitting the database", () => {
    const result = signInSchema.safeParse({ email: 12345 });
    expect(result.success).toBe(false);
  });
});
