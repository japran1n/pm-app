// TH-050…TH-069 — anonymous, non-project-scoped Webflow source fetch for the
// Webflow Code Editor tool.
//
// -------------------------------------------------------------------------
// Why this is a separate route from /api/site-preview/html
// -------------------------------------------------------------------------
// The staging preview route (SP-060…SP-069) is project-scoped: its allowlist
// only accepts URLs that already live in `project_links` for a project the
// caller can see. This route backs the code editor tool, which has no
// project context at all — any authenticated workspace member can point it
// at any `*.webflow.io` URL. Mixing those two access models in a single
// route is exactly how guard bugs happen (round 1 Q7a), so this route keeps
// its own guard chain: auth → https → host allowlist → SSRF, re-validated on
// the final URL after redirects.
//
// -------------------------------------------------------------------------
// Why JSON, not raw HTML
// -------------------------------------------------------------------------
// This route feeds the code editor (F023 clarification round A Q4), not an
// iframe `srcdoc` like the site-preview route. The editor needs the raw HTML
// plus the resolved URL (for relative-link handling and re-fetches) and a
// `blocks` array reserved for the block-extraction pipeline shipped in
// F030/F031. Shipping one JSON envelope now keeps that contract stable
// instead of the editor having to guess `finalUrl` from response headers.
//
// -------------------------------------------------------------------------
// Why the size cap is a stream counter, not a post-`text()` length check
// -------------------------------------------------------------------------
// Same reasoning as the site-preview HTML route: `cappedBodyReader` counts
// bytes as they stream and cancels the moment the cap is crossed, so peak
// memory is bounded by the cap rather than by whatever the upstream sends.

export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import {
  BLOCKED_ADDRESS_ERROR,
  BodyTooLargeError,
  assertResolvableAndPublic,
  cappedBodyReader,
  isWebflowHost,
  isWebflowPasswordGate,
} from "@/lib/site-preview/guards";
import { SafeFetchError, safeFetch } from "@/lib/site-preview/safe-fetch";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";

const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;

export async function GET(request: NextRequest) {
  // 1. Auth — TH-051: no session, no fetch.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }

  const rawUrl = request.nextUrl.searchParams.get("url") ?? "";
  if (!rawUrl) {
    return jsonNoStore({ error: "Missing url parameter" }, 400);
  }

  // 2. Scheme + parse check (TH-052, TH-053).
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return jsonNoStore({ error: "Only HTTPS URLs are supported" }, 400);
  }
  if (parsed.protocol !== "https:") {
    return jsonNoStore({ error: "Only HTTPS URLs are supported" }, 400);
  }

  // 3. SSRF guard — literal localhost check before DNS (TH-058, TH-059).
  // Fixed guard order per spec: auth → https → SSRF → host allowlist.
  try {
    await assertResolvableAndPublic(parsed.hostname);
  } catch {
    return jsonNoStore({ error: BLOCKED_ADDRESS_ERROR }, 400);
  }

  // 4. Host allowlist — only *.webflow.io hosts are fetchable (TH-054…TH-057).
  if (!isWebflowHost(rawUrl)) {
    return jsonNoStore({ error: "URL must be a webflow.io host" }, 403);
  }

  // F024 (TH-060, TH-061) — every redirect hop is re-validated (public
  // address, still a webflow.io host) before it is requested, and the
  // connection is pinned to a checked address.
  let res: Response;
  let finalUrl: string;
  try {
    const result = await safeFetch(parsed, {
      timeoutMs: FETCH_TIMEOUT_MS,
      allowUrl: (hop) => isWebflowHost(hop.toString()),
      // No cookies, no Authorization — anonymous by construction (TH-066).
      headers: { "user-agent": "pm-app webflow source fetch" },
    });
    res = result.response;
    finalUrl = result.url.toString();
  } catch (err) {
    if (err instanceof SafeFetchError) {
      if (err.code === "not_allowed") {
        return jsonNoStore({ error: "redirect left .webflow.io domain" }, 502);
      }
      return jsonNoStore({ error: BLOCKED_ADDRESS_ERROR }, 400);
    }
    if (err instanceof Error && err.name === "TimeoutError") {
      return jsonNoStore({ error: "Upstream timed out" }, 504);
    }
    logger.warn("webflow-source fetch failed", { error: err });
    return jsonNoStore({ error: "Upstream request failed" }, 502);
  }

  if (!res.ok) {
    // TH-065 — surface the upstream status code as-is.
    return jsonNoStore(
      { error: `Upstream returned ${res.status}` },
      res.status,
    );
  }

  if (!res.body) {
    return jsonNoStore({ error: "Upstream returned no body" }, 502);
  }

  // TH-062, TH-063 — streamed 2 MB cap shared with the site-preview guards.
  let html: string;
  try {
    html = await cappedBodyReader(res, MAX_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return jsonNoStore({ error: "Response too large" }, 413);
    }
    logger.warn("webflow-source stream failed", { error: err });
    return jsonNoStore({ error: "Upstream request failed" }, 502);
  }

  // F025 (TH-069) — Webflow's staging password interstitial replaces the
  // real page. Report it as its own error rather than handing the editor a
  // password prompt's HTML and calling it the site.
  if (isWebflowPasswordGate(html)) {
    return jsonNoStore(
      {
        error: "staging_password_required",
        message: "This site requires a staging password",
      },
      403,
    );
  }

  // Response built from scratch — nothing from the upstream response headers
  // is copied across (TH-067), and no upstream `set-cookie` can ever reach
  // the client. `no-store` keeps fetched HTML out of every cache (TH-068).
  return jsonNoStore({ html, finalUrl, blocks: [] }, 200);
}

function jsonNoStore(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
