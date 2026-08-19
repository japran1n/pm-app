import { useEffect, useState } from "react";

import { APP_URL, createExtensionSupabaseClient } from "../lib/supabase";

// F280 (AS-531): popup shell.
// F281 (AS-532, AS-533): real connection status, backed by whatever session
// the storage adapter (chrome.storage.local) currently holds — written by
// the background worker after a successful handoff-token exchange.
type Status =
  | { kind: "loading" }
  | { kind: "connected"; email: string | null }
  | { kind: "signed_out" };

export function Popup() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const supabase = createExtensionSupabaseClient();

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        setStatus({ kind: "connected", email: data.session.user.email ?? null });
      } else {
        setStatus({ kind: "signed_out" });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function openConnectFlow() {
    // Top-level navigation (chrome.tabs.create), not a fetch from the
    // popup — so the browser sends pm-app's own session cookies if the
    // user is already signed in there, and the page itself decides whether
    // to run the handoff (AS-532) or show a sign-in prompt (AS-533).
    chrome.tabs.create({ url: `${APP_URL}/extension-connect` });
  }

  return (
    <main data-testid="popup-root" style={{ padding: 16, minWidth: 240 }}>
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>PM-App QA Feedback</h1>

      {status.kind === "loading" && (
        <p data-testid="connection-status" style={{ margin: 0, color: "#666" }}>
          Checking connection&hellip;
        </p>
      )}

      {status.kind === "connected" && (
        <>
          <p data-testid="connection-status" style={{ margin: 0, color: "#1a7f37" }}>
            Connected{status.email ? ` as ${status.email}` : ""}
          </p>
        </>
      )}

      {status.kind === "signed_out" && (
        <>
          <p data-testid="connection-status" style={{ margin: "0 0 8px", color: "#666" }}>
            Not connected
          </p>
          <p style={{ margin: "0 0 8px", fontSize: 13, color: "#666" }}>
            Sign in to pm-app, then connect the extension to your account.
          </p>
          <button
            data-testid="connect-button"
            type="button"
            onClick={openConnectFlow}
          >
            Sign in to connect
          </button>
        </>
      )}
    </main>
  );
}
