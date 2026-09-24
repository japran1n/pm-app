import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";
import { clip, readJsonCapped, redactUrl } from "@/lib/observability/report-intake";
import { checkRateLimit, clientIpFromHeaders, type RateLimitRule } from "@/lib/rate-limit";

// Client-side errors (thrown in the browser, e.g. a crash in a Client
// Component after hydration) otherwise produce no server-side signal at
// all — the server never sees them. Every error boundary that renders in
// the browser (components/route-error.tsx, app/global-error.tsx) posts
// here best-effort so these show up in the same stdout log stream as
// server-side errors, without requiring an external service (no Sentry —
// see .env.example).
//
// Deliberately unauthenticated: it must work even when the error is an
// auth failure. SEC-HTTP-11 bounds it:
// - body capped at 8KB before buffering (413 over the cap);
// - strict shape (zod), each field clipped rather than rejected so a long
//   real error message is still recorded;
// - the fields are logged NESTED under `client`, so a caller-supplied
//   `message` can never overwrite the log line's own `message`/`level`;
// - the page URL is reduced to origin + path (no query-string secrets);
// - per-IP in-process rate limit (best-effort, per instance).

const RATE_LIMIT: RateLimitRule = { bucket: "client_errors_ip", limit: 20, windowSeconds: 60 };

const clipped = (max: number) => z.string().transform((s) => clip(s, max));

const schema = z.object({
  message: clipped(500),
  digest: clipped(100).optional(),
  url: z
    .string()
    .transform((s) => redactUrl(s, 500))
    .optional(),
  componentStack: clipped(2000).optional(),
});

export async function POST(req: NextRequest) {
  if (!(await checkRateLimit(RATE_LIMIT, clientIpFromHeaders(req.headers)))) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const read = await readJsonCapped(req);
  if (!read.ok) {
    return NextResponse.json(
      { ok: false },
      { status: read.reason === "too_large" ? 413 : 400 },
    );
  }

  const data = schema.safeParse(read.value);
  if (!data.success) return NextResponse.json({ ok: false }, { status: 400 });

  logger.error("client_error", { client: data.data });
  return NextResponse.json({ ok: true });
}
