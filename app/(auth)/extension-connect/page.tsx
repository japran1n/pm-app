import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { mintExtensionHandoffToken } from "@/lib/extension-handoff";
import { Logo } from "@/components/brand/logo";

// F281 (AS-532/AS-533): the page a user lands on when they click "Connect"
// in the extension popup (opened via `chrome.tabs.create`, a top-level
// navigation, so the browser's normal session cookies are sent — no
// separate sign-in inside the extension).
//
// Signed out (AS-533): tells the user to sign in and gives them a link
// back here, so the flow resumes after they authenticate.
//
// Signed in (AS-532): mints a short-lived, single-use handoff token
// (lib/extension-handoff.ts) server-side from the *server's own* resolved
// session — never anything claimed by the client — and renders it in a
// hidden DOM node. `extension/src/content/extension-connect.ts`, a content
// script scoped only to this page's own origin+path in
// extension/manifest.json, reads that node and relays the token to the
// extension's background service worker, which redeems it via
// app/(auth)/extension-connect/exchange/route.ts. The user never retypes
// credentials.
export default async function ExtensionConnectPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <Logo className="h-5 w-auto text-foreground" />
        <div className="flex max-w-sm flex-col gap-3">
          <h1 className="title-2 font-semibold tracking-tight">
            Sign in to connect the extension
          </h1>
          <p className="text-mini text-muted-foreground" data-testid="extension-connect-signed-out">
            You need to be signed in to pm-app to connect the QA feedback
            extension.
          </p>
          <Link
            href="/sign-in?next=/extension-connect"
            data-testid="extension-connect-sign-in-link"
            className="text-mini font-medium underline underline-offset-4"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    // Extremely unlikely (getUser() already re-validated the JWT), but if
    // the session cookie is somehow gone by this point, fail loudly rather
    // than minting a token from nothing.
    return (
      <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <p role="alert" data-testid="extension-connect-error">
          Your session could not be read. Please sign in again.
        </p>
        <Link href="/sign-in?next=/extension-connect" className="underline">
          Sign in
        </Link>
      </main>
    );
  }

  const token = mintExtensionHandoffToken({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    userId: user.id,
    email: user.email ?? null,
  });

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="title-2 font-semibold tracking-tight">pm-app</span>
      <h1 className="title-2 font-semibold tracking-tight">
        Connecting the extension&hellip;
      </h1>
      <p className="text-mini text-muted-foreground" data-testid="extension-connect-signed-in">
        Signed in as {user.email}. You can close this tab once the extension
        shows &quot;Connected&quot;.
      </p>
      {/* Read by extension/src/content/extension-connect.ts. Single-use,
          expires in 60s — safe to render in the DOM. */}
      <div
        hidden
        data-testid="extension-handoff"
        data-extension-token={token}
      />
    </main>
  );
}
