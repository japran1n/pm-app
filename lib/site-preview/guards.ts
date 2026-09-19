// SP-061, SP-062 — shared request guards for every /api/site-preview/* route.
//
// This file is the single home of the guard chain. The probe route (F02) and the
// HTML proxy route (F09) both call `runPreviewGuards`; neither re-implements any
// part of it. SP-061 explicitly forbids a second copy of this logic.
//
// Guard order is fixed and identical for every caller:
//   1. auth        → 401  (no session, no preview)
//   2. https only  → 400  (also catches unparseable URLs)
//   3. SSRF        → 400  (literal `localhost`, then every resolved DNS address)
//   4. allowlist   → 403  (URL must belong to the project's staging/live links)
//
// Allowlist modes (SP-062):
//   "exact"  — the probe: the URL must be byte-identical to a stored link.
//   "origin" — the HTML proxy: only the *origin* has to match a stored link,
//              because internal navigation (F11) requests deep paths like
//              /anvandningsomraden/badrum while `project_links` stores only the
//              root URL. Comparison is always `new URL(...).origin` equality —
//              never `endsWith`/`includes`, which would happily accept
//              `https://sajt.webflow.io.evil.com/`.

import dns from "dns";
import { createClient } from "@/lib/supabase/server";
import { getProjectStagingLinks } from "@/lib/queries/project-site";

// ---------------------------------------------------------------------------
// SSRF address classification — pure, exported for tests (F03/F12)
// ---------------------------------------------------------------------------

function ipv4ToInt(ip: string): number {
  return ip
    .split(".")
    .reduce((acc, octet) => (acc << 8) | parseInt(octet, 10), 0) >>> 0;
}

function inCidrV4(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const mask = bits === "32" ? 0xffffffff : (~0 << (32 - parseInt(bits, 10))) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

function inCidrV6(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);

  // Expand both to comparable hex strings at byte boundary
  const norm = (addr: string): string => {
    // Minimal IPv6 normalisation sufficient for the ranges we check
    if (addr.includes("::")) {
      const [left, right] = addr.split("::");
      const leftGroups = left ? left.split(":") : [];
      const rightGroups = right ? right.split(":") : [];
      const missing = 8 - leftGroups.length - rightGroups.length;
      const groups = [
        ...leftGroups,
        ...Array(missing).fill("0"),
        ...rightGroups,
      ];
      return groups.map((g) => g.padStart(4, "0")).join(":");
    }
    return addr
      .split(":")
      .map((g) => g.padStart(4, "0"))
      .join(":");
  };

  const ipNorm = norm(ip.toLowerCase());
  const baseNorm = norm(base.toLowerCase());

  const ipHex = ipNorm.replace(/:/g, "");
  const baseHex = baseNorm.replace(/:/g, "");

  const prefixBytes = Math.floor(bits / 4); // hex chars for full nibbles
  return ipHex.slice(0, prefixBytes) === baseHex.slice(0, prefixBytes);
}

export function isBlockedAddress(ip: string): boolean {
  const lower = ip.toLowerCase().trim();

  if (lower === "localhost") return true;
  if (lower === "0.0.0.0") return true;
  if (lower === "::1") return true;

  // IPv4 ranges
  if (ip.includes(".")) {
    return (
      inCidrV4(ip, "127.0.0.0/8") ||
      inCidrV4(ip, "10.0.0.0/8") ||
      inCidrV4(ip, "172.16.0.0/12") ||
      inCidrV4(ip, "192.168.0.0/16") ||
      inCidrV4(ip, "169.254.0.0/16") ||
      inCidrV4(ip, "100.64.0.0/10")
    );
  }

  // IPv6 ranges
  return inCidrV6(lower, "fe80::/10") || inCidrV6(lower, "fc00::/7");
}

export const BLOCKED_ADDRESS_ERROR = "URL resolves to a blocked address";

/**
 * Resolves `hostname` and throws if it is a literal `localhost`, fails to
 * resolve, or resolves to any blocked address. Exported so the HTML proxy can
 * re-run the check on the *final* URL after `redirect: "follow"`.
 */
export async function assertResolvableAndPublic(hostname: string): Promise<void> {
  if (hostname.toLowerCase() === "localhost") {
    throw new Error(BLOCKED_ADDRESS_ERROR);
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    throw new Error(BLOCKED_ADDRESS_ERROR);
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(BLOCKED_ADDRESS_ERROR);
    }
  }
}

// ---------------------------------------------------------------------------
// Framing policy parser — pure, exported for tests (F03)
// ---------------------------------------------------------------------------

export function readFramingPolicy(
  headers: Headers,
  selfOrigin: string,
): { embeddable: boolean; reason: string } {
  // X-Frame-Options
  const xfo = headers.get("x-frame-options")?.trim().toLowerCase();
  if (xfo === "deny" || xfo === "sameorigin") {
    return { embeddable: false, reason: "x_frame_options" };
  }

  // Content-Security-Policy → frame-ancestors
  const csp = headers.get("content-security-policy");
  if (csp) {
    const directives = csp.split(";").map((d) => d.trim());
    const fa = directives.find((d) =>
      d.toLowerCase().startsWith("frame-ancestors"),
    );
    if (fa) {
      const sources = fa
        .replace(/^frame-ancestors\s*/i, "")
        .split(/\s+/)
        .map((s) => s.toLowerCase());

      if (sources.includes("'none'")) {
        return { embeddable: false, reason: "csp_frame_ancestors" };
      }
      if (sources.includes("*") || sources.includes(selfOrigin.toLowerCase())) {
        return { embeddable: true, reason: "ok" };
      }
      return { embeddable: false, reason: "csp_frame_ancestors" };
    }
  }

  return { embeddable: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Capped body reader (TH-062, TH-063, TH-070) — extracted from the HTML proxy
// route so every caller shares one implementation. Streams `res.body`,
// counting bytes as they arrive, and throws `BodyTooLargeError` the moment
// the running total exceeds `maxBytes` — never buffers past the cap.
// ---------------------------------------------------------------------------

export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Response body exceeded ${maxBytes} bytes`);
    this.name = "BodyTooLargeError";
  }
}

export const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

export async function cappedBodyReader(
  res: Response,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  if (!res.body) {
    throw new Error("Response has no body");
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder("utf-8").decode(buffer);
}

// ---------------------------------------------------------------------------
// Webflow host allowlist predicate — pure, exported for tests (TH-054..057)
// ---------------------------------------------------------------------------

export function isWebflowHost(input: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const labels = parsed.hostname.split(".");
  if (labels.length < 2) {
    return false;
  }

  const lastTwo = labels.slice(-2);
  return lastTwo[0] === "webflow" && lastTwo[1] === "io";
}

// ---------------------------------------------------------------------------
// The guard chain
// ---------------------------------------------------------------------------

export type GuardFailure = { status: number; error: string };

export type GuardResult =
  | { ok: true; url: URL }
  | ({ ok: false } & GuardFailure);

export async function runPreviewGuards(args: {
  rawUrl: string;
  projectId: string;
  mode: "exact" | "origin";
}): Promise<GuardResult> {
  const { rawUrl, projectId, mode } = args;

  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  // 2. Scheme check — an unparseable URL fails here too
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      status: 400,
      error: "Only HTTPS URLs are supported",
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      ok: false,
      status: 400,
      error: "Only HTTPS URLs are supported",
    };
  }

  // 3. SSRF guard — literal localhost check before DNS
  try {
    await assertResolvableAndPublic(parsed.hostname);
  } catch {
    return { ok: false, status: 400, error: BLOCKED_ADDRESS_ERROR };
  }

  // 4. Allowlist — project staging links (RLS already scopes to caller's projects)
  const stagingResult = await getProjectStagingLinks(projectId);
  if (!stagingResult.ok) {
    return {
      ok: false,
      status: 403,
      error: "URL not in project staging links",
    };
  }

  const match = stagingResult.data.find((link) => {
    if (mode === "exact") return link.url === rawUrl;
    // Origin mode: strict origin equality — scheme + host + port — so a
    // look-alike host such as `sajt.webflow.io.evil.com` can never match.
    try {
      return new URL(link.url).origin === parsed.origin;
    } catch {
      return false;
    }
  });

  if (!match) {
    return {
      ok: false,
      status: 403,
      error: "URL not in project staging links",
    };
  }

  return { ok: true, url: parsed };
}
