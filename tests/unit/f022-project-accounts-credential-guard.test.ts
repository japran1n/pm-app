// Unit test for F022's client-side half of the credential guard
// (AS-050): `looksLikeCredential` and the Zod schemas built on it in
// lib/validation/project-site.ts. The matching server-side half is the
// CHECK constraints exercised live in
// tests/integration/f022-links-accounts-docs-visibility-rls.test.ts.

import { describe, expect, it } from "vitest";
import {
  createProjectAccountSchema,
  looksLikeCredential,
} from "@/lib/validation/project-site";

describe("AS-050: looksLikeCredential rejects obvious secret shapes", () => {
  it.each([
    ["sk_live_51H8x9yzABCDEFGHIJ1234567890", "Stripe-shaped secret key"],
    ["pk_test_51H8x9yzABCDEFGHIJ1234567890", "publishable-key-shaped value"],
    ["ghp_1234567890abcdefghijklmnopqrstuv", "GitHub personal access token"],
    ["xoxb-1234567890-abcdefghijklmnop", "Slack bot token"],
    ["-----BEGIN PRIVATE KEY-----", "PEM header"],
    [
      "aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxkaGVsbG93b3JsZA==",
      "a long base64-ish run",
    ],
  ])("flags %s (%s)", (value) => {
    expect(looksLikeCredential(value)).toBe(true);
  });

  it("does not flag an ordinary, short tool name", () => {
    expect(looksLikeCredential("Webflow")).toBe(false);
    expect(looksLikeCredential("Google Search Console")).toBe(false);
    expect(looksLikeCredential("Domain registrar")).toBe(false);
  });

  it("does not flag null or empty values", () => {
    expect(looksLikeCredential(null)).toBe(false);
    expect(looksLikeCredential(undefined)).toBe(false);
    expect(looksLikeCredential("")).toBe(false);
  });

  it("does not flag an ordinary handover note (prose, not a secret shape)", () => {
    expect(
      looksLikeCredential(
        "Transferred to the client's own Google Analytics 4 account after handover on the 3rd.",
      ),
    ).toBe(false);
  });
});

describe("AS-050: createProjectAccountSchema rejects a credential-shaped service or note with an actionable message", () => {
  it("rejects a service value shaped like a secret and names the password manager", () => {
    const result = createProjectAccountSchema.safeParse({
      projectId: "00000000-0000-0000-0000-000000000000",
      service: "sk_live_51H8x9yzABCDEFGHIJ1234567890",
      owner: "agency",
      status: "pending",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/password manager/i);
    }
  });

  it("rejects a note value shaped like a secret", () => {
    const result = createProjectAccountSchema.safeParse({
      projectId: "00000000-0000-0000-0000-000000000000",
      service: "Domain registrar",
      owner: "agency",
      status: "pending",
      note: "-----BEGIN PRIVATE KEY-----",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/password manager/i);
    }
  });

  it("accepts a legitimate Webflow site name (does not gold-plate the guard)", () => {
    const result = createProjectAccountSchema.safeParse({
      projectId: "00000000-0000-0000-0000-000000000000",
      service: "Webflow",
      owner: "agency",
      status: "provisioned",
      note: "Site name: acme-marketing-site",
    });
    expect(result.success).toBe(true);
  });
});
