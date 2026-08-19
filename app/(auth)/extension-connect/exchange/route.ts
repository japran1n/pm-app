import { NextResponse, type NextRequest } from "next/server";

import { consumeExtensionHandoffToken } from "@/lib/extension-handoff";
import { extensionHandoffExchangeSchema } from "@/lib/validation/extension";

// F281 (AS-532/AS-538): the one narrow endpoint the extension's background
// service worker calls to redeem a one-time handoff token for a session.
// Zod-validated body; identity is resolved entirely from the encrypted
// token minted in app/(auth)/extension-connect/page.tsx — this route never
// trusts an identity claimed in the request payload (there isn't one to
// trust; the payload is just the opaque token).
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

  const result = consumeExtensionHandoffToken(parsed.data.token);

  if (!result.ok) {
    const status = result.reason === "invalid" ? 400 : 410; // 410 Gone: expired or already used
    const message =
      result.reason === "invalid"
        ? "This handoff token is invalid."
        : result.reason === "expired"
          ? "This handoff token has expired. Reopen the extension and connect again."
          : "This handoff token was already used. Reopen the extension and connect again.";
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({
    access_token: result.session.accessToken,
    refresh_token: result.session.refreshToken,
    user: {
      id: result.session.userId,
      email: result.session.email,
    },
  });
}
