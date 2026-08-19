import { beforeAll, describe, expect, it } from "vitest";

import {
  consumeExtensionHandoffToken,
  mintExtensionHandoffToken,
} from "@/lib/extension-handoff";
import { extensionHandoffExchangeSchema } from "@/lib/validation/extension";

beforeAll(() => {
  process.env.EXTENSION_HANDOFF_SECRET ??= "test-secret-not-for-production";
});

const session = {
  accessToken: "access-token-abc",
  refreshToken: "refresh-token-xyz",
  userId: "11111111-1111-4111-8111-111111111111",
  email: "reporter@example.com",
};

describe("extension handoff token (AS-532, AS-538)", () => {
  it("AS-532: a token minted from a real session round-trips to the same session on first consume", () => {
    const token = mintExtensionHandoffToken(session);
    const result = consumeExtensionHandoffToken(token);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session).toEqual(session);
    }
  });

  it("AS-538: the minted token never contains the app's Supabase secret key material", () => {
    const token = mintExtensionHandoffToken(session);
    // The secret-key prefix used across this project (SUPABASE_SECRET_KEY,
    // see .env.example / lib/supabase/admin.ts) must never appear in
    // anything handed to the extension, including this token.
    expect(token).not.toContain("sb_secret_");
  });

  it("rejects a token that has already been consumed once (best-effort single-use)", () => {
    const token = mintExtensionHandoffToken(session);
    const first = consumeExtensionHandoffToken(token);
    const second = consumeExtensionHandoffToken(token);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("already_used");
    }
  });

  it("rejects a tampered token", () => {
    const token = mintExtensionHandoffToken(session);
    const tampered = token.slice(0, -4) + "abcd";

    const result = consumeExtensionHandoffToken(tampered);
    expect(result.ok).toBe(false);
  });

  it("rejects garbage input rather than throwing", () => {
    const result = consumeExtensionHandoffToken("not-a-real-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("invalid");
    }
  });
});

describe("extensionHandoffExchangeSchema (AS-532)", () => {
  it("accepts a well-formed token string", () => {
    const result = extensionHandoffExchangeSchema.safeParse({
      token: "some-opaque-token",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a missing token", () => {
    const result = extensionHandoffExchangeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a non-string token (never trusts an arbitrary payload shape)", () => {
    const result = extensionHandoffExchangeSchema.safeParse({ token: 12345 });
    expect(result.success).toBe(false);
  });
});
