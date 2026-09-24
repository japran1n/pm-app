import { NextResponse, type NextRequest } from "next/server";

import {
  consumeExtensionHandoffToken,
  mintExtensionSession,
} from "@/lib/extension-handoff";
import { createAdminClient } from "@/lib/supabase/admin";
import { extensionHandoffExchangeSchema } from "@/lib/validation/extension";

// F281 (AS-532/AS-538): the one narrow endpoint the extension's background
// service worker calls to redeem a one-time handoff token for a session.
// Zod-validated body; identity is resolved entirely from the encrypted
// token minted in app/(auth)/extension-connect/page.tsx — this route never
// trusts an identity claimed in the request payload (there isn't one to
// trust; the payload is just the opaque token).
//
// Audit SEC-HTTP-08 / SEC-EXT-02: the response is a NEW session minted for
// the extension alone (lib/extension-handoff.ts mintExtensionSession) —
// never the web app's own session — so the extension's refresh-token
// rotation and its "Disconnect" (local-scope signOut) cannot affect the
// user's browser session.
export async function POST(request: NextRequest) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = extensionHandoffExchangeSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const result = await consumeExtensionHandoffToken(parsed.data.token, admin);

  if (!result.ok) {
    if (result.reason === "unavailable") {
      return NextResponse.json(
        { error: "Could not connect right now. Please try again in a moment." },
        { status: 503 },
      );
    }
    const status = result.reason === "invalid" ? 400 : 410; // 410 Gone: expired or already used
    const message =
      result.reason === "invalid"
        ? "This handoff token is invalid."
        : result.reason === "expired"
          ? "This handoff token has expired. Reopen the extension and connect again."
          : "This handoff token was already used. Reopen the extension and connect again.";
    return NextResponse.json({ error: message }, { status });
  }

  const session = await mintExtensionSession(result.userId, admin);
  if (!session) {
    return NextResponse.json(
      { error: "Could not create an extension session. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      access_token: session.accessToken,
      refresh_token: session.refreshToken,
      user: {
        id: session.userId,
        email: session.email,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
