// Unit test for F274's magic-byte sniff (AS-206 hardening): the
// content-based check that replaces trusting the client-declared
// `File.type`. Pure byte-array logic, no Supabase — the action-level
// integration test (tests/integration/upload-avatar.test.ts) exercises the
// full server rejection through the real Server Action.

import { describe, expect, it } from "vitest";

import {
  sniffAvatarMimeType,
  matchesDeclaredAvatarMimeType,
} from "@/lib/validation/profile";

describe("test_AS_206_avatar_mime_sniff", () => {
  it("sniffs a real JPEG signature (FF D8 FF) as image/jpeg", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(sniffAvatarMimeType(bytes)).toBe("image/jpeg");
  });

  it("sniffs a real PNG signature as image/png", () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ]);
    expect(sniffAvatarMimeType(bytes)).toBe("image/png");
  });

  it("sniffs a real WebP (RIFF....WEBP) signature as image/webp", () => {
    const bytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x00, 0x00, 0x00, 0x00, // size (irrelevant to the check)
      0x57, 0x45, 0x42, 0x50, // WEBP
    ]);
    expect(sniffAvatarMimeType(bytes)).toBe("image/webp");
  });

  it("returns null for arbitrary non-image bytes — the evil.exe-renamed-to-evil.png case", () => {
    // Eight arbitrary bytes, exactly what the (now-fixed) AS-203 test used
    // to construct as a fake "image/png" — not a PNG by any definition.
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(sniffAvatarMimeType(bytes)).toBeNull();
  });

  it("returns null for an ELF/executable-style header", () => {
    const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]); // \x7fELF
    expect(sniffAvatarMimeType(bytes)).toBeNull();
  });

  it("matchesDeclaredAvatarMimeType is true only when sniffed type equals the declared type", () => {
    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(matchesDeclaredAvatarMimeType(pngBytes, "image/png")).toBe(true);
    expect(matchesDeclaredAvatarMimeType(pngBytes, "image/jpeg")).toBe(false);
  });

  it("matchesDeclaredAvatarMimeType is false when bytes are not a real image but declare image/png — the spoofed-MIME attack", () => {
    const spoofedBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(matchesDeclaredAvatarMimeType(spoofedBytes, "image/png")).toBe(
      false,
    );
  });
});
