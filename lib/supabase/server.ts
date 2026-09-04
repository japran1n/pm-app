// Server Component / Server Action Supabase client (cookie-based, RLS-respecting).
// Uses the new sb_publishable_* key format per tech-decisions.md — NOT the
// secret key. This is the client used by application logic; RLS is the
// authorization boundary. Next.js 16: cookies() is async-only.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// F024 (missions/20260903-portal, AS-052): "view the portal as a specific
// client" is implemented by minting a REAL session for that client
// (lib/actions/portal-preview.ts) and storing its access/refresh tokens
// in cookies scoped to `path: "/portal"`. Because of that path scoping,
// the browser only ever sends these two cookie names on a request to
// `/portal/*` — every request under `/w/*` (the team app) never has them
// in its Cookie header at all, so the branch below is unreachable there
// and this function's behavior for the rest of the app is byte-for-byte
// unchanged. This is what lets the entire portal route tree (every
// Server Component under app/(portal)/portal/[workspaceSlug]/**) render
// through the client's own RLS-backed session with NO changes to any of
// those components or queries — see this feature's spec section 2 for
// why a `previewAsClientId` query-parameter approach was rejected
// instead.
const PORTAL_PREVIEW_ACCESS_COOKIE = "portal_preview_access_token";
const PORTAL_PREVIEW_REFRESH_COOKIE = "portal_preview_refresh_token";

export async function createClient() {
  const cookieStore = await cookies();

  const previewAccessToken = cookieStore.get(PORTAL_PREVIEW_ACCESS_COOKIE)?.value;
  const previewRefreshToken = cookieStore.get(PORTAL_PREVIEW_REFRESH_COOKIE)?.value;

  if (previewAccessToken && previewRefreshToken) {
    // A no-op cookie adapter deliberately: this client's session must
    // NEVER be persisted back into the browser's real cookies (that
    // would overwrite the previewer's own team session, or leak the
    // impersonated session outside `/portal`). `setSession` below only
    // sets this one request-scoped client instance's in-memory auth
    // state — nothing is written anywhere.
    const previewClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => [],
          setAll: () => {},
        },
      },
    );
    await previewClient.auth.setSession({
      access_token: previewAccessToken,
      refresh_token: previewRefreshToken,
    });
    return previewClient;
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll called from a Server Component — safe to ignore because
            // proxy.ts refreshes the session on every request.
          }
        },
      },
    },
  );
}
