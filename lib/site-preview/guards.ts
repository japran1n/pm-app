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
import { isIP } from "net";
import { createClient } from "@/lib/supabase/server";
import { getProjectStagingLinks } from "@/lib/queries/project-site";

// ---------------------------------------------------------------------------
// SSRF address classification — pure, exported for tests (F03/F12)
// ---------------------------------------------------------------------------

// Every address is parsed to raw bytes before classification, so alternate
// spellings (`::ffff:127.0.0.1`, `::ffff:7f00:1`, `0:0:0:0:0:0:0:1`, `::`,
// bracketed or zone-suffixed forms) cannot slip past a string comparison.
// Anything that does not parse as an IP literal is treated as blocked.

function parseIpv4(ip: string): number[] | null {
  if (isIP(ip) !== 4) return null;
  const parts = ip.split(".").map((p) => Number(p));
  return parts.length === 4 ? parts : null;
}

function parseIpv6(input: string): number[] | null {
  let ip = input;
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (isIP(ip) !== 6) return null;

  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(":");
  const lastGroup = ip.slice(lastColon + 1);
  if (lastGroup.includes(".")) {
    const v4 = parseIpv4(lastGroup);
    if (!v4) return null;
    tail = v4;
    ip = ip.slice(0, lastColon + 1) + "0:0";
  }

  const [left, right] = ip.includes("::") ? ip.split("::") : [ip, undefined];
  const leftGroups = left ? left.split(":").filter((g) => g !== "") : [];
  const rightGroups = right ? right.split(":").filter((g) => g !== "") : [];
  const missing = 8 - leftGroups.length - rightGroups.length;
  if (right === undefined && missing !== 0) return null;
  const groups = [
    ...leftGroups,
    ...Array<string>(right === undefined ? 0 : missing).fill("0"),
    ...rightGroups,
  ];
  if (groups.length !== 8) return null;

  const bytes: number[] = [];
  for (const g of groups) {
    const n = parseInt(g, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  if (tail.length === 4) bytes.splice(12, 4, ...tail);
  return bytes;
}

function isBlockedIpv4([a, b, c]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8 "this network" (0.0.0.1 reaches localhost on Linux)
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) || // IETF protocol assignments
    (a === 192 && b === 0 && c === 2) || // TEST-NET-1
    (a === 192 && b === 88 && c === 99) || // 6to4 relay anycast
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) || // TEST-NET-2
    (a === 203 && b === 0 && c === 113) || // TEST-NET-3
    a >= 224 // multicast, reserved, broadcast
  );
}

function isBlockedIpv6(bytes: number[]): boolean {
  const isZero = (from: number, to: number) =>
    bytes.slice(from, to).every((b) => b === 0);

  // ::/96 — unspecified (::), loopback (::1) and IPv4-compatible (::a.b.c.d).
  if (isZero(0, 12)) return true;
  // ::ffff:0:0/96 — IPv4-mapped: classify the embedded IPv4 address.
  if (isZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isBlockedIpv4(bytes.slice(12, 16));
  }
  // 64:ff9b::/96 NAT64 — classify the embedded IPv4 address.
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (isZero(4, 12)) return isBlockedIpv4(bytes.slice(12, 16));
    return true; // 64:ff9b:1::/48 local-use NAT64
  }
  // 2002::/16 6to4 — classify the embedded IPv4 address.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isBlockedIpv4(bytes.slice(2, 6));
  }
  // 2001::/32 Teredo, 2001:db8::/32 documentation.
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return true;
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  }
  // 100::/64 discard-only.
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && isZero(2, 8)) return true;
  if ((bytes[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return true; // fe80::/10
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0xc0) return true; // fec0::/10
  if (bytes[0] === 0xff) return true; // multicast
  return false;
}

export function isBlockedAddress(ip: string): boolean {
  const trimmed = ip.trim().toLowerCase();
  const v4 = parseIpv4(trimmed);
  if (v4) return isBlockedIpv4(v4);
  const v6 = parseIpv6(trimmed);
  if (v6) return isBlockedIpv6(v6);
  return true;
}

export const BLOCKED_ADDRESS_ERROR = "URL resolves to a blocked address";

/**
 * Resolves `hostname` and throws if it is `localhost`, fails to resolve, or
 * resolves to any blocked address. `safeFetch` (./safe-fetch.ts) runs this on
 * every redirect hop and repeats the check at connect time.
 */
export async function assertResolvableAndPublic(
  hostname: string,
): Promise<dns.LookupAddress[]> {
  let host = hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (!host || host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(BLOCKED_ADDRESS_ERROR);
  }

  const literalFamily = isIP(host);
  if (literalFamily !== 0) {
    if (isBlockedAddress(host)) throw new Error(BLOCKED_ADDRESS_ERROR);
    return [{ address: host, family: literalFamily }];
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(host, { all: true });
  } catch {
    throw new Error(BLOCKED_ADDRESS_ERROR);
  }

  if (addresses.length === 0) throw new Error(BLOCKED_ADDRESS_ERROR);
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new Error(BLOCKED_ADDRESS_ERROR);
    }
  }
  return addresses;
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

// ---------------------------------------------------------------------------
// Webflow staging password gate detector — pure, exported for tests (TH-069)
// ---------------------------------------------------------------------------

/**
 * Webflow's staging password interstitial replaces the page with a small
 * form: a `<input type="password">` inside a `<form>`, plus Webflow-specific
 * markers (`data-wf-*` attributes, the `webflow.io` badge/copy, or the
 * literal "password" prompt Webflow ships). Any single one of these signals
 * is common enough to produce false positives on its own (password fields
 * are everywhere; "webflow.io" appears in normal page HTML too), so this
 * requires the form+password-field combination *and* at least one
 * Webflow-specific gate marker before reporting a match.
 */
export function isWebflowPasswordGate(html: string): boolean {
  const formMatches = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) ?? [];
  const hasPasswordForm = formMatches.some((form) =>
    /<input\b[^>]*\btype\s*=\s*["']?password["']?/i.test(form),
  );
  if (!hasPasswordForm) return false;

  const gateMarkers = [
    /data-wf-page-id/i,
    /data-wf-site/i,
    /w-password-page/i,
    /this site is password protected/i,
    /this page is password protected/i,
    /enter the password to view this page/i,
  ];

  return gateMarkers.some((marker) => marker.test(html));
}

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
  // TH-055 — a subdomain must exist. The bare apex `webflow.io` (2 labels)
  // is Webflow's own marketing site, never a customer's staging/live site.
  if (labels.length < 3) {
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
