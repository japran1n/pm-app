// SP-010…SP-019 — embeddability probe for staging preview
// Probes a URL's framing policy (X-Frame-Options / CSP frame-ancestors).
// Guards (auth → scheme → SSRF → allowlist) live in lib/site-preview/guards.ts
// and are shared with the HTML proxy route; SP-061 forbids duplicating them
// here. This route uses allowlist mode "exact" — a probe is only ever issued
// for a URL that is stored verbatim in the project's links.
// Never logs the URL value; never caches; always force-dynamic.

export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import { readFramingPolicy, runPreviewGuards } from "@/lib/site-preview/guards";
import { logger } from "@/lib/observability/logger";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const rawUrl = searchParams.get("url") ?? "";
  const projectId = searchParams.get("projectId") ?? "";

  const guard = await runPreviewGuards({ rawUrl, projectId, mode: "exact" });
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  // Probe — SP-018: network error → embeddable: true, reason: probe_failed
  const selfOrigin = new URL(request.url).origin;

  try {
    const response = await fetch(guard.url.toString(), {
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
