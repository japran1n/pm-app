import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { logger } from "@/lib/observability/logger";

// Client-side errors (thrown in the browser, e.g. a crash in a Client
// Component after hydration) otherwise produce no server-side signal at
// all — the server never sees them. Every error boundary that renders in
// the browser (components/route-error.tsx, app/global-error.tsx) posts
// here best-effort so these show up in the same stdout log stream as
// server-side errors, without requiring an external service (no Sentry —
// see .env.example).
//
// Deliberately unauthenticated: it must work even when the error is an
// auth failure. Input is bounded and validated so it can't be used to
// smuggle arbitrary large payloads into the log stream.
const schema = z.object({
  message: z.string().max(500),
  digest: z.string().max(100).optional(),
  url: z.string().max(500).optional(),
  componentStack: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const data = schema.safeParse(body);
    if (!data.success) return NextResponse.json({ ok: false }, { status: 400 });
    logger.error("client_error", data.data);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
