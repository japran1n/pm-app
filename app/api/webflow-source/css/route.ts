// TH-080…TH-084 — anonymous CSS proxy for the code editor's Webflow source
// fetch layer.
//
// This route mirrors `app/api/webflow-source/route.ts` (F023) but is scoped
// to stylesheet assets: `*.webflow.io` hosts only, https only, a 500 KB cap
// (stylesheets are much smaller than full HTML documents), and a
// `text/css` content type with a short public cache — CSS assets referenced
// from a Webflow staging page do not change from request to request within a
// single editing session, so a five-minute cache is safe and cuts redundant
// upstream fetches when the editor re-renders.
//
// Guard order is fixed, same as every other site-preview/webflow-source
// route: auth -> https -> host allowlist. There is no project-scoped
// allowlist here (unlike `/api/site-preview/html`) because this route is not
// tied to a specific project's staging links — any authenticated workspace
// member may fetch any `*.webflow.io` stylesheet, matching F023's contract.

export const dynamic = "force-dynamic";

import { NextResponse, type NextRequest } from "next/server";
import {
  BodyTooLargeError,
  cappedBodyReader,
  isWebflowHost,
} from "@/lib/site-preview/guards";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/observability/logger";

const MAX_BYTES = 512 * 1024; // 500 KB (TH-083)

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const rawUrl = searchParams.get("url") ?? "";

  // 1. Auth (TH-082)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. https + host allowlist (TH-081)
  if (!rawUrl || !isWebflowHost(rawUrl)) {
    return NextResponse.json(
      { error: "URL must be an https://*.webflow.io stylesheet" },
      { status: 400 },
    );
  }

  const url = new URL(rawUrl);

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
      // Anonymous fetch — no cookies, no Authorization header.
      headers: { "user-agent": "pm-app webflow source proxy" },
    });
  } catch (err) {
    logger.warn("webflow-source css fetch failed", { error: err });
    return NextResponse.json({ error: "Upstream request failed" }, { status: 502 });
  }

  if (!res.ok) {
    return NextResponse.json(
      { error: `Upstream returned ${res.status}` },
      { status: 502 },
    );
  }

  if (!res.body) {
    return NextResponse.json({ error: "Upstream returned no body" }, { status: 502 });
  }

  // TH-083 — streamed 500 KB cap, shared implementation with the HTML proxy.
  let css: string;
  try {
    css = await cappedBodyReader(res, MAX_BYTES);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return NextResponse.json({ error: "Response too large" }, { status: 413 });
    }
    logger.warn("webflow-source css stream failed", { error: err });
    return NextResponse.json({ error: "Upstream request failed" }, { status: 502 });
  }

  // TH-084 — response built from scratch, nothing copied from upstream
  // headers, so no upstream `set-cookie` (or anything else) can leak through.
  return new NextResponse(css, {
    status: 200,
    headers: {
      "content-type": "text/css",
      "cache-control": "public, max-age=300",
    },
  });
}
