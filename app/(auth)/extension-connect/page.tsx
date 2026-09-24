import Link from "next/link";

import { getCurrentUser } from "@/lib/auth/current-user";
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
// (lib/extension-handoff.ts) server-side for the *server's own* resolved
// user — never anything claimed by the client — and renders it in a
// hidden DOM node. `extension/src/content/extension-connect.ts`, a content
// script scoped only to this page's own origin+path in
// extension/manifest.json, reads that node and relays the token to the
// extension's background service worker, which redeems it via
// app/(auth)/extension-connect/exchange/route.ts. The user never retypes
// credentials.
export default async function ExtensionConnectPage() {
  const { user } = await getCurrentUser();

  if (!user) {
    return (
      <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
        <Logo className="h-5 w-auto text-foreground" />
        <div className="flex max-w-sm flex-col gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Sign in to connect the extension
          </h1>
          <p className="text-sm text-muted-foreground" data-testid="extension-connect-signed-out">
            You need to be signed in to pm-app to connect the QA feedback
            extension.
          </p>
          <Link
            href="/sign-in?next=/extension-connect"
            data-testid="extension-connect-sign-in-link"
            className="text-sm font-medium underline underline-offset-4"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  // Audit SEC-HTTP-08: the token carries only the user id — never this
  // browser session's tokens. The exchange route mints a separate session
  // for the extension.
  const token = mintExtensionHandoffToken({ userId: user.id });

  return (
    <main className="flex min-h-svh flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <span className="text-2xl font-semibold tracking-tight">pm-app</span>
      <h1 className="text-2xl font-semibold tracking-tight">
        Connecting the extension&hellip;
      </h1>
      <p className="text-sm text-muted-foreground" data-testid="extension-connect-signed-in">
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
