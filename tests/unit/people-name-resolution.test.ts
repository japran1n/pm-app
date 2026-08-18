// Unit test for F123 (AS-202)'s fix to lib/queries/people.ts's fallback
// chain: display_name -> user_metadata.full_name -> email local part ->
// full email. `emailLocalPart` is the new, pure piece of that chain (the
// rest — the actual Supabase/Auth Admin API calls inside `resolvePeople`
// — is exercised end-to-end against the real linked project in
// tests/integration/update-profile.test.ts, since it needs a real user
// row to resolve).

import { describe, expect, it } from "vitest";

import { emailLocalPart } from "@/lib/queries/people";

describe("test_AS_202_email_local_part_fallback", () => {
  it("returns everything before the @ for an ordinary address", () => {
    expect(emailLocalPart("j.smith@example.com")).toBe("j.smith");
  });

  it("handles a local part that itself contains dots/plus-addressing", () => {
    expect(emailLocalPart("first.last+tag@sub.example.co")).toBe(
      "first.last+tag",
    );
  });

  it("falls back to the full string when there is no @ at all (defensive)", () => {
    expect(emailLocalPart("not-an-email")).toBe("not-an-email");
  });

  it("falls back to the full string when the local part would be empty (address starts with @)", () => {
    expect(emailLocalPart("@example.com")).toBe("@example.com");
  });
});
