import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { createClient as createServerSupabaseClient } from "@/lib/supabase/server";

// DEV-ONLY convenience route: logs in as a given email instantly, without
// sending a real magic-link email (bypasses Supabase Auth's email-send
// rate limit, which is what blocks repeated local testing). Sets the same
// SSR cookie `lib/supabase/server.ts`'s createClient() reads
// (`sb-<project-ref>-auth-token`), using the admin API's generateLink to
// mint a real session server-side.
//
// Hard-disabled outside development: returns 404 in any other NODE_ENV so
// this can never be reachable in a deployed environment.
//
// Usage: /dev-login?email=you@example.com

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse("Not found", { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const email = searchParams.get("email");
  if (!email) {
    return new NextResponse("Missing ?email= query param", { status: 400 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const secretKey = process.env.SUPABASE_SECRET_KEY!;

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties) {
    return new NextResponse(`Failed to generate session: ${error?.message}`, {
      status: 500,
    });
  }

  // generateLink for a project using PKCE returns tokens via the
  // action_link's redirect (implicit-flow shape: access_token/refresh_token
  // as URL fragment params on Supabase's own /verify endpoint) rather than
  // a code — fetch it server-side and parse those tokens directly, the
  // same approach tests/e2e/board-reorder.spec.ts uses for a real browser
  // session without an inbox.
  const verifyResponse = await fetch(data.properties.action_link, {
    redirect: "manual",
  });
  const location = verifyResponse.headers.get("location");
  if (!location) {
    return new NextResponse("Verify link did not redirect", { status: 500 });
  }
  const fragment = new URL(location).hash.slice(1);
  const params = new URLSearchParams(fragment);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const expiresIn = params.get("expires_in");
  const expiresAt = params.get("expires_at");
  if (!accessToken || !refreshToken) {
    return new NextResponse(
      `No session tokens in verify redirect: ${location}`,
      { status: 500 },
    );
  }

  // Let the real @supabase/ssr server client (the same one every Server
  // Action/Component in this app uses) write the session cookies itself via
  // setSession() — it knows the exact cookie name/chunking format it
  // expects to read back, which a hand-rolled cookie value does not
  // reliably match (this is what broke the first version of this route:
  // proxy.ts's session refresh couldn't parse a manually-encoded cookie and
  // silently dropped it, bouncing back to /sign-in).
  void expiresIn;
  void expiresAt;
  const supabase = await createServerSupabaseClient();
  const { error: setSessionError } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (setSessionError) {
    return new NextResponse(
      `Failed to establish session: ${setSessionError.message}`,
      { status: 500 },
    );
  }

  redirect("/");
}
