// Standalone Sitemap tool, Phase 1: coverage for generateShareToken
// (lib/actions/sitemaps.ts) -- the DoD requirement that a share token be
// "URL-safe unguessable ... at least 128 bits of entropy".

import { describe, expect, it } from "vitest";
import { generateShareToken } from "@/lib/sitemaps/share-token";

describe("generateShareToken", () => {
  it("is URL-safe (no characters requiring percent-encoding)", () => {
    const token = generateShareToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("carries at least 128 bits of entropy (>= 22 base64url chars for 16 raw bytes)", () => {
    const token = generateShareToken();
    // base64url encodes 6 bits/char with no padding; 128 bits needs at
    // least ceil(128/6) = 22 characters. This repo's implementation uses
    // 32 raw bytes (256 bits), comfortably over the floor.
    expect(token.length).toBeGreaterThanOrEqual(22);
  });

  it("generates a different token on every call (not a fixed/guessable value)", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateShareToken()));
    expect(tokens.size).toBe(50);
  });
});
