import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// F281 (AS-532/AS-533): server-only helpers for the extension session
// handoff.
//
// Chosen pattern (see tech-decisions.md "QA feedback extension" and the
// F281 clarification's tie-breaker rule — "take the simpler, more private
// option"): a short-lived one-time token, not `externally_connectable`.
// `externally_connectable` requires the web app to call
// `chrome.runtime.sendMessage(extensionId, ...)`, which means either
// publishing the extension to pin a stable id or shipping a generated
// signing key in the manifest just to keep an unpacked-dev id stable —
// more moving parts, and it still means the extension is *listening* for
// messages from any tab that matches the declared origin pattern. A
// one-time token minted server-side and read out of the DOM by a content
// script scoped to our own `/extension-connect` page never opens a
// listening surface at all: the content script only *reads*, it never
// *receives* messages from the page, and the token is useless without the
// server round-trip in `consumeExtensionHandoffToken` below.
//
// The token is an AES-256-GCM–encrypted, base64url-encoded blob containing
// the session's access/refresh tokens plus an expiry. No secret Supabase
// key is embedded in it or anywhere client-side; the encryption key
// (`EXTENSION_HANDOFF_SECRET`) is a server-only env var, never sent to the
// browser.
//
// "One-time": enforced two ways. (1) The token embeds a short (60s) TTL,
// checked on every consume. (2) A best-effort in-memory set of already-
// consumed token digests rejects replay within the same server process.
// (2) does not survive a process restart or span multiple serverless
// instances — documented as a known limitation in the F281 handoff rather
// than solved with a new database table, which the 45-minute budget for
// this feature does not cover; the 60s TTL is the primary defense.

const ALGORITHM = "aes-256-gcm";
const TOKEN_TTL_MS = 60_000;

type HandoffPayload = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string | null;
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

export function mintExtensionHandoffToken(input: {
  accessToken: string;
  refreshToken: string;
  userId: string;
  email: string | null;
}): string {
  const payload: HandoffPayload = {
    accessToken: input.accessToken,
    refreshToken: input.refreshToken,
    userId: input.userId,
    email: input.email,
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

export type ConsumeResult =
  | { ok: true; session: Omit<HandoffPayload, "expiresAt"> }
  | { ok: false; reason: "invalid" | "expired" | "already_used" };

export function consumeExtensionHandoffToken(token: string): ConsumeResult {
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

  let raw: Buffer;
  try {
    raw = Buffer.from(token, "base64url");
  } catch {
    return { ok: false, reason: "invalid" };
  }

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
    typeof payload.accessToken !== "string" ||
    typeof payload.refreshToken !== "string" ||
    typeof payload.userId !== "string" ||
    typeof payload.expiresAt !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }

  if (Date.now() > payload.expiresAt) {
    return { ok: false, reason: "expired" };
  }

  consumedDigests.add(tokenDigest);

  return {
    ok: true,
    session: {
      accessToken: payload.accessToken,
      refreshToken: payload.refreshToken,
      userId: payload.userId,
      email: payload.email,
    },
  };
}
