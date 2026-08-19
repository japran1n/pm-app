import { useEffect, useRef, useState } from "react";

import { APP_URL, createExtensionSupabaseClient } from "../lib/supabase";
import { captureVisibleTab } from "../capture/visible-tab";
import { setLastCapture, type CapturedScreenshot } from "../capture/store";

// F280 (AS-531): popup shell.
// F281 (AS-532, AS-533): real connection status, backed by whatever session
// the storage adapter (chrome.storage.local) currently holds — written by
// the background worker after a successful handoff-token exchange.
//
// F282 (AS-534, AS-535, AS-536, AS-537): the popup never keeps auth state
// only in its own React state / in-memory JS — every mount re-derives
// status by calling `getSession()`, which reads `chrome.storage.local`
// through the storage adapter and (per supabase-js's own
// `__loadSession()`, verified against
// node_modules/@supabase/auth-js/dist/module/GoTrueClient.js on
// @supabase/supabase-js@2.112.3) transparently refreshes the access token
// when it's within its expiry margin, silently rewriting the refreshed
// session back into `chrome.storage.local`. This is why refresh is "lazy"
// here rather than a `setInterval`-driven background loop in the service
// worker: an MV3 worker idles out and any `setInterval` inside it stops
// firing, but a popup (or a fresh worker) that calls `getSession()` on
// every cold start reproduces the same effect on demand, which is exactly
// what AS-534/AS-535 require (rehydration from storage, not from memory
// that may no longer exist).
//
// If the refresh token itself is rejected (not just proactively refreshed
// early), `getSession()` resolves with `{ session: null, error }` and
// supabase-js's own `_callRefreshToken` has already removed the dead
// session from `chrome.storage.local` (`_removeSession()`, which also
// fires a `SIGNED_OUT` auth-state-change event) — AS-536's "silent
// refresh, stated-reason failure": success is invisible to the user
// (session simply keeps working), failure is not (see the "expired"
// status below).
type Status =
  | { kind: "loading" }
  | { kind: "connected"; email: string | null }
  | { kind: "signed_out" }
  | { kind: "expired" };

export function Popup() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  // Distinguishes a SIGNED_OUT auth-state-change event caused by the user
  // clicking "Disconnect" (expected, no reason needed) from one caused by
  // a failed token refresh (AS-536: must state a reason). This is the only
  // piece of in-memory state the popup keeps, and it only affects which
  // message is shown for an event that just happened in *this* mount — it
  // is never relied on to know whether a session exists, so it does not
  // violate the "re-derivable from storage" requirement above.
  const explicitSignOutRef = useRef(false);

  // F283 (AS-539, AS-541): capture state is independent of connection
  // status — capturing the visible tab needs only `activeTab`, not an
  // authenticated session (auth only matters once a later feature files
  // the task). Kept local to this component (not chrome.storage) per the
  // "simpler/narrower" tie-breaker in the clarification: it only needs to
  // survive the current popup mount.
  type CaptureUiState =
    | { kind: "idle" }
    | { kind: "capturing" }
    | { kind: "captured"; capture: CapturedScreenshot }
    | { kind: "error"; reason: string };
  const [captureState, setCaptureState] = useState<CaptureUiState>({ kind: "idle" });

  async function handleCapture() {
    setCaptureState({ kind: "capturing" });
    const result = await captureVisibleTab();
    if (result.ok) {
      setLastCapture(result);
      setCaptureState({ kind: "captured", capture: result });
    } else {
      setCaptureState({ kind: "error", reason: result.reason });
    }
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createExtensionSupabaseClient();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "SIGNED_OUT") {
        setStatus(
          explicitSignOutRef.current
            ? { kind: "signed_out" }
            : { kind: "expired" },
        );
        explicitSignOutRef.current = false;
      } else if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        setStatus({
          kind: "connected",
          email: session?.user.email ?? null,
        });
      }
    });

    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        // A dead refresh token — supabase-js already cleared
        // chrome.storage.local for us (_removeSession), so there is
        // nothing left to reconcile here beyond telling the user why.
        setStatus({ kind: "expired" });
      } else if (data.session) {
        setStatus({ kind: "connected", email: data.session.user.email ?? null });
      } else {
        // No session in storage. Note that a failed-refresh path may
        // already have delivered a SIGNED_OUT auth-state-change event
        // (which sets "expired") *before* this promise settles — by the
        // time __loadSession() re-reads storage here, supabase-js has
        // already removed the dead session, so this branch also sees
        // `session: null, error: null` even though the true reason was a
        // failed refresh, not "never connected". Defer to whatever the
        // event listener already decided (it fires first and knows the
        // reason) rather than blindly overwriting an "expired" status
        // with a plain "signed_out" one.
        setStatus((prev) => (prev.kind === "expired" ? prev : { kind: "signed_out" }));
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  function openConnectFlow() {
    // Top-level navigation (chrome.tabs.create), not a fetch from the
    // popup — so the browser sends pm-app's own session cookies if the
    // user is already signed in there, and the page itself decides whether
    // to run the handoff (AS-532) or show a sign-in prompt (AS-533).
    chrome.tabs.create({ url: `${APP_URL}/extension-connect` });
  }

  async function disconnect() {
    // AS-537: signing out must clear chrome.storage.local completely and
    // leave no residue — not just the supabase-js session key, but any
    // other cache this extension ever writes there. supabase-js's
    // `signOut()` removes its own storage key (and calls the server to
    // revoke the refresh token); `chrome.storage.local.clear()`
    // afterwards is belt-and-suspenders so a future cached-profile key
    // introduced elsewhere in the extension can never survive a
    // disconnect either.
    explicitSignOutRef.current = true;
    const supabase = createExtensionSupabaseClient();
    await supabase.auth.signOut();
    await chrome.storage.local.clear();
    setStatus({ kind: "signed_out" });
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
          <p data-testid="connection-status" style={{ margin: "0 0 8px", color: "#1a7f37" }}>
            Connected{status.email ? ` as ${status.email}` : ""}
          </p>
          <button data-testid="disconnect-button" type="button" onClick={disconnect}>
            Disconnect
          </button>
        </>
      )}

      {status.kind === "expired" && (
        <>
          <p data-testid="connection-status" style={{ margin: "0 0 8px", color: "#b91c1c" }}>
            Not connected
          </p>
          <p
            data-testid="signed-out-reason"
            style={{ margin: "0 0 8px", fontSize: 13, color: "#b91c1c" }}
          >
            Session expired. Please reconnect.
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

      {status.kind !== "loading" && (
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e5e5e5" }}>
          <button
            data-testid="capture-button"
            type="button"
            onClick={handleCapture}
            disabled={captureState.kind === "capturing"}
          >
            {captureState.kind === "capturing" ? "Capturing…" : "Capture screenshot"}
          </button>

          {captureState.kind === "captured" && (
            <div style={{ marginTop: 8 }}>
              <p data-testid="capture-success" style={{ margin: "0 0 4px", fontSize: 13, color: "#1a7f37" }}>
                Screenshot captured.
              </p>
              <img
                data-testid="capture-preview"
                src={captureState.capture.dataUrl}
                alt="Captured screenshot preview"
                style={{ maxWidth: "100%", border: "1px solid #ddd" }}
              />
            </div>
          )}

          {captureState.kind === "error" && (
            <p
              data-testid="capture-error"
              style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}
            >
              {captureState.reason}
            </p>
          )}
        </div>
      )}
    </main>
  );
}
