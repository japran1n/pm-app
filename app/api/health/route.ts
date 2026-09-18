// P2-20: health check for uptime monitoring — use anon client, NOT admin
//
// Public, unauthenticated endpoint suitable for BetterUptime / uptime
// monitors pointing at `/api/health`. Uses the standard cookie-based
// `createClient()` (user-scoped, RLS-respecting) without any session
// cookies, so Supabase treats it as an anonymous request — same client
// every other Server Component uses, never the service-role admin key.
//
// DB connectivity check: count the caller's visible workspace_members
// rows (limit 0 — PostgREST returns the count header without fetching
// any rows). RLS means this returns 0 for an anon session, but any DB
// error (connection refused, timeout, etc.) surfaces as a non-null error
// and triggers the 503.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  try {
    const supabase = await createClient();

    const { error } = await supabase
      .from("workspace_members")
      .select("count", { count: "exact", head: true })
      .limit(0);

    if (error) {
      return NextResponse.json({ ok: false }, { status: 503 });
    }

    return NextResponse.json(
      { ok: true, ts: new Date().toISOString() },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
