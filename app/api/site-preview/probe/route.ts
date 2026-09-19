// SP-010…SP-019 — embeddability probe for staging preview
// Probes a URL's framing policy (X-Frame-Options / CSP frame-ancestors).
// Five guards in order: auth → scheme → SSRF → allowlist → probe.
// Never logs the URL value; never caches; always force-dynamic.

export const dynamic = "force-dynamic";

import dns from "dns";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProjectStagingLinks } from "@/lib/queries/project-site";
import { logger } from "@/lib/observability/logger";

// ---------------------------------------------------------------------------
// SSRF guard — pure, exported for F03 tests
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

// ---------------------------------------------------------------------------
// Framing policy parser — pure, exported for F03 tests
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
      if (
        sources.includes("*") ||
        sources.includes(selfOrigin.toLowerCase())
      ) {
        return { embeddable: true, reason: "ok" };
      }
      return { embeddable: false, reason: "csp_frame_ancestors" };
    }
  }

  return { embeddable: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // 1. Auth
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const rawUrl = searchParams.get("url") ?? "";
  const projectId = searchParams.get("projectId") ?? "";

  // 2. Scheme check
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return NextResponse.json(
      { error: "Only HTTPS URLs are supported" },
      { status: 400 },
    );
  }
  if (parsed.protocol !== "https:") {
    return NextResponse.json(
      { error: "Only HTTPS URLs are supported" },
      { status: 400 },
    );
  }

  const hostname = parsed.hostname;

  // 3. SSRF guard — literal localhost check before DNS
  if (hostname.toLowerCase() === "localhost") {
    return NextResponse.json(
      { error: "URL resolves to a blocked address" },
      { status: 400 },
    );
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true });
  } catch {
    return NextResponse.json(
      { error: "URL resolves to a blocked address" },
      { status: 400 },
    );
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      return NextResponse.json(
        { error: "URL resolves to a blocked address" },
        { status: 400 },
      );
    }
  }

  // 4. Allowlist — project staging links (RLS already scopes to caller's projects)
  const stagingResult = await getProjectStagingLinks(projectId);
  if (!stagingResult.ok) {
    return NextResponse.json(
      { error: "URL not in project staging links" },
      { status: 403 },
    );
  }
  const match = stagingResult.data.find((link) => link.url === rawUrl);
  if (!match) {
    return NextResponse.json(
      { error: "URL not in project staging links" },
      { status: 403 },
    );
  }

  // 5. Probe — SP-018: network error → embeddable: true, reason: probe_failed
  const selfOrigin = new URL(request.url).origin;

  try {
    const response = await fetch(rawUrl, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });

    const policy = readFramingPolicy(response.headers, selfOrigin);
    return NextResponse.json(policy);
  } catch (err) {
    logger.warn("site-preview probe failed", { error: err });
    return NextResponse.json({ embeddable: true, reason: "probe_failed" });
  }
}
