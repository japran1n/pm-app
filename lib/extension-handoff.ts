import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { serverEnv } from "@/lib/env";
import { logger } from "@/lib/observability/logger";

// F281 (AS-532/AS-533): server-only helpers for the extension session
// handoff. A short-lived one-time token is rendered by
// app/(auth)/extension-connect/page.tsx, read out of the DOM by the
// extension's content script (scoped to that one page), and redeemed by the
// extension's service worker at app/(auth)/extension-connect/exchange.
//
// Audit SEC-HTTP-08 / SEC-EXT-02 / GAP5-07 (2026-09-24): the token used to
// carry the web session's OWN access + refresh tokens. That handed the
// extension the browser session itself: refresh-token rotation on either
// side randomly logged the other out, and "Disconnect" (a global signOut)
// ended every session the user had. Now:
//
//  - The token carries only { userId, nonce, expiresAt } — no credentials.
//  - On redeem, the server mints a SEPARATE Supabase session for the same
//    user (admin generateLink -> verifyOtp with the hashed token, no email
//    sent — same mechanism app/dev-login/route.ts uses). The extension's
//    refresh token belongs to its own session family; the web session is
//    never read, rotated or revoked by anything the extension does.
//  - Single use is enforced in the DATABASE (not just in memory), via the
//    existing service-role-only `bump_extension_rate_limit` counter with a
//    per-token bucket and limit 1. The in-memory set stays as a cheap
//    first check. A DB error fails CLOSED here (unlike the API rate limit,
//    which fails open) — this is an auth gate.
//
// The token is AES-256-GCM encrypted with EXTENSION_HANDOFF_SECRET (a
// server-only env var) and expires after 60 seconds.

const ALGORITHM = "aes-256-gcm";
const TOKEN_TTL_MS = 60_000;

// One fixed window from the epoch to 2038: floor(epoch / 2^31-1) is 0 for
// every timestamp before 2038-01-19, so the (user, bucket) row is a single
// permanent "already redeemed" marker rather than a counter that resets.
const SINGLE_USE_WINDOW_SECONDS = 2_147_483_647;

type HandoffPayload = {
  userId: string;
  nonce: string;
  expiresAt: number; // epoch ms
};

const consumedDigests = new Set<string>();

function getKey(): Buffer {
  const secret = process.env.EXTENSION_HANDOFF_SECRET;
  if (!secret) {
    throw new Error(
      "EXTENSION_HANDOFF_SECRET is not set; cannot mint or consume extension handoff tokens.",
    );
  }
  return createHash("sha256").update(secret).digest();
}

function digest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintExtensionHandoffToken(input: { userId: string }): string {
  const payload: HandoffPayload = {
    userId: input.userId,
    nonce: randomBytes(16).toString("hex"),
    expiresAt: Date.now() + TOKEN_TTL_MS,
  };

  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString("base64url");
}

export type DecodeResult =
  | { ok: true; userId: string; digest: string }
  | { ok: false; reason: "invalid" | "expired" | "already_used" };

/**
 * Pure part of redeeming a token: decrypt, validate shape and expiry, and
 * reject tokens already seen by THIS process. Marks the token as consumed
 * in memory on success. Does not touch the database — see
 * `consumeExtensionHandoffToken` for the durable single-use check.
 */
export function decodeExtensionHandoffToken(token: string): DecodeResult {
  let key: Buffer;
  try {
    key = getKey();
  } catch {
    return { ok: false, reason: "invalid" };
  }

  const tokenDigest = digest(token);
  if (consumedDigests.has(tokenDigest)) {
    return { ok: false, reason: "already_used" };
  }

  const raw = Buffer.from(token, "base64url");
  if (raw.length < 12 + 16) {
    return { ok: false, reason: "invalid" };
  }

  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);

  let payload: HandoffPayload;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    payload = JSON.parse(decrypted.toString("utf8")) as HandoffPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (
    typeof payload.userId !== "string" ||
    typeof payload.nonce !== "string" ||
    typeof payload.expiresAt !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (Date.now() > payload.expiresAt) {
    return { ok: false, reason: "expired" };
  }

  consumedDigests.add(tokenDigest);
  return { ok: true, userId: payload.userId, digest: tokenDigest };
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "already_used" | "unavailable" };

/**
 * Redeem a handoff token exactly once across every server instance.
 */
export async function consumeExtensionHandoffToken(
  token: string,
  admin: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<ConsumeResult> {
  const decoded = decodeExtensionHandoffToken(token);
  if (!decoded.ok) return decoded;

  const { data: firstUse, error } = await admin.rpc("bump_extension_rate_limit", {
    p_user_id: decoded.userId,
    p_bucket: `handoff:${decoded.digest}`,
    p_limit: 1,
    p_window_seconds: SINGLE_USE_WINDOW_SECONDS,
  });

  if (error) {
    logger.error("extension-handoff: single-use check failed; rejecting (fail-closed)", {
      error,
    });
    return { ok: false, reason: "unavailable" };
  }
  if (firstUse !== true) {
    return { ok: false, reason: "already_used" };
  }

  return { ok: true, userId: decoded.userId };
}

export type ExtensionSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string | null;
};

/**
 * Mint a brand-new Supabase session for `userId`, independent of any
 * session the user already has (browser or otherwise). Uses the admin
 * `generateLink` API to obtain a hashed magic-link token (no email is
 * sent) and immediately verifies it server-side on a throwaway client, so
 * the link itself never leaves this function.
 */
export async function mintExtensionSession(
  userId: string,
  admin: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<ExtensionSession | null> {
  const { data: userData, error: userError } =
    await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (userError || !email) {
    logger.error("extension-handoff: could not load user for session mint", {
      error: userError,
    });
    return null;
  }

  const { data: linkData, error: linkError } =
    await admin.auth.admin.generateLink({ type: "magiclink", email });
  const hashedToken = linkData?.properties?.hashed_token;
  if (linkError || !hashedToken) {
    logger.error("extension-handoff: generateLink failed", { error: linkError });
    return null;
  }

  const env = serverEnv();
  const verifier = createSupabaseClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data: verified, error: verifyError } = await verifier.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  const session = verified?.session;
  if (verifyError || !session || session.user.id !== userId) {
    logger.error("extension-handoff: verifyOtp failed", { error: verifyError });
    return null;
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId,
    email: session.user.email ?? null,
  };
}
