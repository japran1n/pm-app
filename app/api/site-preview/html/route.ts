// SP-060…SP-069 — anonymous HTML proxy for the staging preview.
//
// -------------------------------------------------------------------------
// Why srcdoc and not a plain <iframe src>
// -------------------------------------------------------------------------
// Webflow staging hosts ship a framing policy that makes a direct embed
// impossible. Verified 2026-09-19 with
//   curl -I https://stenmagasinet-staging.webflow.io/
// which returns
//   content-security-policy: frame-ancestors 'self' https://*.webflow.com
//                            http://*.webflow.io …
// Our origin is not in that list, so the browser refuses to render the frame.
// `frame-ancestors` is enforced on the *response that gets framed*: with
// `srcdoc` there is no navigation to that origin at all, so there is no
// response carrying the header and nothing to enforce. Hence: the server
// fetches the HTML here, the client drops it into `srcdoc`.
//
// -------------------------------------------------------------------------
// Why that is legitimate and not a CSP bypass in spirit
// -------------------------------------------------------------------------
// The threat model behind `frame-ancestors` is clickjacking of an
// *authenticated session*: an attacker frames a logged-in user's bank page and
// tricks them into clicking through it. None of that applies here:
//   * The fetch is anonymous. No cookies, no Authorization header, no
//     credentials of any kind are forwarded (SP-067), so there is no session to
//     hijack and the frame shows exactly what an anonymous visitor sees.
//   * The content is public HTML that anyone can `curl` without authenticating.
//   * The viewer is the site's own owner or their client, looking at their own
//     staging site inside our workspace.
// Access is additionally gated by our own guards: the caller must be signed in
// and the URL must belong to a project the caller can see.
//
// -------------------------------------------------------------------------
// Why the 2 MB cap is a stream counter, not a post-`text()` length check
// -------------------------------------------------------------------------
// `await res.text()` buffers the entire body into memory *before* we can look
// at its size — a 50 MB upstream response would already have been read into the
// server process by the time we decided to reject it. Instead we read
// `res.body` through a reader, count bytes as they arrive, and `cancel()` the
// stream the moment the counter crosses the limit (SP-063). Peak memory is
// bounded by the cap, not by whatever upstream chooses to send.
//
// -------------------------------------------------------------------------
// Why the allowlist is origin-level here, exact in the probe
// -------------------------------------------------------------------------
// `project_links` stores only the root staging URL, but internal navigation
// (F11) asks this route for deep paths such as /anvandningsomraden/badrum. An
// exact match would reject every page but the homepage. So this route matches on
// `new URL(...).origin` equality (SP-062) — strict equality, never `endsWith`
// or `includes`, which would accept a look-alike host such as
// `https://sajt.webflow.io.evil.com/`. A URL on any other origin is 403.
//
// -------------------------------------------------------------------------
// CRITICAL cross-file invariant — lives in the component, not here
// -------------------------------------------------------------------------
// The HTML this route returns is foreign, untrusted, script-bearing markup. It
// MUST be placed into `srcdoc` with `sandbox="allow-scripts"` and WITHOUT
// `allow-same-origin` (SP-075). Those two flags together let the framed
// document reach its own frame element and remove the sandbox attribute, after
// which foreign JS runs in *our* origin with access to our localStorage,
// cookies and authenticated fetches. The consuming component is
// `components/shared/site-preview-frame.tsx` — if that attribute pair ever
// changes, this route becomes a full same-origin XSS vector.

// -------------------------------------------------------------------------
// Why the response is text/plain, not text/html
// -------------------------------------------------------------------------
// The component reads this route with `fetch()` + `res.text()` and hands the
// string to `srcdoc`; it never navigates to it. Served as `text/html` on our
// origin, the same URL opened as a top-level page (one click on a crafted
// link) would run the foreign script with our origin's cookies and storage.
// So: `text/plain` + `nosniff` (the browser will not render it as HTML), a
// `sandbox` CSP (an opaque origin even if something did render it), and any
// request whose Sec-Fetch-Dest is not "empty" (a navigation, frame, embed or
// object load rather than a fetch) is refused outright.

export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import {
  BLOCKED_ADDRESS_ERROR,
  BodyTooLargeError,
  cappedBodyReader,
  runPreviewGuards,
} from "@/lib/site-preview/guards";
import { SafeFetchError, safeFetch } from "@/lib/site-preview/safe-fetch";
import { injectBaseTag, injectNavInterceptor } from "@/lib/site-preview/inject";
import { logger } from "@/lib/observability/logger";

const MAX_BYTES = 2 * 1024 * 1024;

const SECURITY_HEADERS = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "content-security-policy": "sandbox; default-src 'none'",
  "cross-origin-resource-policy": "same-origin",
} as const;

function jsonError(error: string, status: number): NextResponse {
  return NextResponse.json({ error }, { status, headers: SECURITY_HEADERS });
}

export async function GET(request: NextRequest) {
  const dest = request.headers.get("sec-fetch-dest");
  const mode = request.headers.get("sec-fetch-mode");
  if ((dest && dest !== "empty") || mode === "navigate") {
    return jsonError("Not a document", 403);
  }

  const { searchParams } = request.nextUrl;
  const rawUrl = searchParams.get("url") ?? "";
  const projectId = searchParams.get("projectId") ?? "";

  // auth → https → SSRF → origin allowlist
  const guard = await runPreviewGuards({ rawUrl, projectId, mode: "origin" });
  if (!guard.ok) {
    return jsonError(guard.error, guard.status);
  }

  // Every redirect hop is re-validated before it is followed, and the
  // connection itself is pinned to a checked address (see safe-fetch.ts).
  // No cookies, no Authorization — the fetch is anonymous by construction
  // (SP-067).
  let res: Response;
  try {
    ({ response: res } = await safeFetch(guard.url, {
      timeoutMs: 10_000,
      headers: { "user-agent": "pm-app staging preview" },
    }));
  } catch (err) {
    if (err instanceof SafeFetchError) {
      return err.code === "too_many_redirects"
        ? jsonError("Too many redirects", 502)
        : jsonError(BLOCKED_ADDRESS_ERROR, 400);
    }
    logger.warn("site-preview html fetch failed", { error: err });
    return jsonError("Upstream timed out", 504);
  }

  if (!res.ok) {
    return jsonError(`Upstream returned ${res.status}`, res.status);
  }

  if (!res.body) {
    return jsonError("Upstream returned no body", 502);
  }

  // SP-063 — streamed 2 MB cap: count bytes as they arrive and cancel the
  // stream the moment the limit is crossed, so we never buffer a huge body.
  let html: string;
  try {
    html = await cappedBodyReader(res, MAX_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return jsonError("Response too large", 502);
    }
    logger.warn("site-preview html stream failed", { error: err });
    return jsonError("Upstream timed out", 504);
  }

  // Relative URLs must resolve against the staging origin, not the srcdoc base.
  html = injectBaseTag(html, guard.url.origin);
  // Link clicks are handed back to the host page instead of navigating.
  html = injectNavInterceptor(html);

  // Built from scratch — nothing from the upstream response headers is copied
  // across, so no upstream `set-cookie` can ever be forwarded (SP-068).
  return new NextResponse(html, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
