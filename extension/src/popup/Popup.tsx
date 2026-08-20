import { useEffect, useRef, useState } from "react";

import { APP_URL, createExtensionSupabaseClient } from "../lib/supabase";
import { captureVisibleTab } from "../capture/visible-tab";
import { setLastCapture, setAnnotatedResult, type CapturedScreenshot } from "../capture/store";
import { RegionSelect } from "../capture/RegionSelect";
import type { CropResult } from "../capture/crop";
import { AnnotationEditor } from "../annotate/canvas";
import type { FlattenResult } from "../annotate/types";
import { pickElementOnActiveTab, type PickResult } from "../capture/element-picker";
import {
  startConsoleCaptureOnActiveTab,
  getConsoleCaptureFromActiveTab,
  type ConsoleLogEntry,
} from "../capture/console-hook";

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
  // F284 (AS-540): after a full-tab capture, the user may either keep it as
  // is ("captured") or open the region-select UI ("selecting") to crop it
  // down to a chosen area ("cropped"). Selecting never re-triggers
  // `chrome.tabs.captureVisibleTab` — it only crops the PNG this component
  // already has, so the whole-view and region-capture paths cannot diverge.
  // F285 (AS-542, AS-543, AS-545): once the user has a capture (whole-view
  // or cropped), they can open the annotation editor ("annotating") on
  // whichever image they ended up with — cropped takes precedence over
  // the full capture when both exist, since a crop is a deliberate
  // narrowing of what the user wants attached. Confirming annotations
  // produces "annotated": the flattened PNG replaces what's shown/held
  // for the next stage; the pristine base image is never shown again once
  // annotations exist (AS-545).
  type CaptureUiState =
    | { kind: "idle" }
    | { kind: "capturing" }
    | { kind: "captured"; capture: CapturedScreenshot }
    | { kind: "selecting"; capture: CapturedScreenshot }
    | { kind: "cropped"; capture: CapturedScreenshot; cropped: CropResult }
    | { kind: "annotating"; capture: CapturedScreenshot; cropped: CropResult | null }
    | { kind: "annotated"; capture: CapturedScreenshot; cropped: CropResult | null; annotated: FlattenResult }
    | { kind: "error"; reason: string };
  const [captureState, setCaptureState] = useState<CaptureUiState>({ kind: "idle" });

  // F287 (AS-546, AS-547): independent of the screenshot capture flow —
  // the reporter can point at an element on the page whether or not
  // they've also captured a screenshot. `picking` covers the whole
  // hover/click/Escape interaction (which runs on the live page via
  // chrome.scripting.executeScript, not in this popup document), so the
  // popup itself just shows "waiting" until the injected picker resolves.
  type ElementPickUiState =
    | { kind: "idle" }
    | { kind: "picking" }
    | { kind: "picked"; result: Extract<PickResult, { ok: true }> }
    | { kind: "unsupported"; reason: "shadow-dom-unsupported" | "iframe-unsupported" }
    | { kind: "cancelled" }
    | { kind: "error"; reason: string };
  const [pickState, setPickState] = useState<ElementPickUiState>({ kind: "idle" });

  // F289 (AS-550, AS-551, AS-552): console capture is a deliberate,
  // user-triggered action (not always-on), per the clarification's
  // "less data, simpler, more private" default and because there is no
  // toggle from F291 to gate it behind yet (see this feature's handoff
  // "Out-of-scope work needed" — a future feature can wrap a persistent
  // on/off preference around this trigger without changing this
  // component's contract). It only ever sees console activity produced
  // after the button below is clicked — AS-552's limitation is stated in
  // the UI text itself, not just in a code comment.
  type ConsoleCaptureUiState =
    | { kind: "idle" }
    | { kind: "starting" }
    | { kind: "active"; entries: ConsoleLogEntry[] }
    | { kind: "error"; reason: string };
  const [consoleCaptureState, setConsoleCaptureState] = useState<ConsoleCaptureUiState>({ kind: "idle" });

  async function handleStartConsoleCapture() {
    setConsoleCaptureState({ kind: "starting" });
    const result = await startConsoleCaptureOnActiveTab();
    if (!result.ok) {
      setConsoleCaptureState({ kind: "error", reason: result.reason });
      return;
    }
    setConsoleCaptureState({ kind: "active", entries: [] });
  }

  async function handleRefreshConsoleCapture() {
    const result = await getConsoleCaptureFromActiveTab();
    if (!result.ok) {
      setConsoleCaptureState({ kind: "error", reason: result.reason });
      return;
    }
    setConsoleCaptureState({ kind: "active", entries: result.entries });
  }

  async function handlePickElement() {
    setPickState({ kind: "picking" });
    const result = await pickElementOnActiveTab();
    if (result.ok) {
      setPickState({ kind: "picked", result });
    } else if (result.reason === "cancelled") {
      setPickState({ kind: "cancelled" });
    } else if (result.reason === "shadow-dom-unsupported" || result.reason === "iframe-unsupported") {
      setPickState({ kind: "unsupported", reason: result.reason });
    } else {
      setPickState({ kind: "error", reason: result.reason });
    }
  }

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

  function handleStartRegionSelect() {
    if (captureState.kind === "captured" || captureState.kind === "cropped") {
      setCaptureState({ kind: "selecting", capture: captureState.capture });
    }
  }

  function handleRegionCropped(cropped: CropResult) {
    if (captureState.kind === "selecting") {
      setCaptureState({ kind: "cropped", capture: captureState.capture, cropped });
    }
  }

  function handleRegionSelectCancel() {
    // Escape or "Use full screenshot": drop back to the plain full-tab
    // capture with no region selected — never leaves the overlay mounted,
    // never discards the underlying capture itself (AS-539 still works).
    if (captureState.kind === "selecting") {
      setCaptureState({ kind: "captured", capture: captureState.capture });
    }
  }

  function handleStartAnnotate() {
    if (captureState.kind === "captured") {
      setCaptureState({ kind: "annotating", capture: captureState.capture, cropped: null });
    } else if (captureState.kind === "cropped") {
      setCaptureState({ kind: "annotating", capture: captureState.capture, cropped: captureState.cropped });
    }
  }

  function handleAnnotationSubmit(result: FlattenResult) {
    if (captureState.kind !== "annotating") return;
    // AS-545: the flattened annotated PNG — not the pristine capture or
    // crop underneath it — is what's held for the next stage.
    setAnnotatedResult(result);
    setCaptureState({
      kind: "annotated",
      capture: captureState.capture,
      cropped: captureState.cropped,
      annotated: result,
    });
  }

  function handleAnnotationCancel() {
    if (captureState.kind !== "annotating") return;
    if (captureState.cropped) {
      setCaptureState({ kind: "cropped", capture: captureState.capture, cropped: captureState.cropped });
    } else {
      setCaptureState({ kind: "captured", capture: captureState.capture });
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
              <button
                data-testid="region-select-start-button"
                type="button"
                style={{ marginTop: 8 }}
                onClick={handleStartRegionSelect}
              >
                Select region…
              </button>
              <button
                data-testid="annotate-start-button"
                type="button"
                style={{ marginTop: 8, marginLeft: 8 }}
                onClick={handleStartAnnotate}
              >
                Annotate…
              </button>
            </div>
          )}

          {captureState.kind === "selecting" && (
            <div style={{ marginTop: 8 }}>
              <RegionSelect
                capture={captureState.capture}
                onCropped={handleRegionCropped}
                onCancel={handleRegionSelectCancel}
              />
            </div>
          )}

          {captureState.kind === "cropped" && (
            <div style={{ marginTop: 8 }}>
              <p data-testid="capture-success" style={{ margin: "0 0 4px", fontSize: 13, color: "#1a7f37" }}>
                Region captured ({captureState.cropped.width} x {captureState.cropped.height} px).
              </p>
              <img
                data-testid="capture-preview"
                src={captureState.cropped.dataUrl}
                alt="Cropped screenshot preview"
                style={{ maxWidth: "100%", border: "1px solid #ddd" }}
              />
              <button
                data-testid="region-select-start-button"
                type="button"
                style={{ marginTop: 8 }}
                onClick={handleStartRegionSelect}
              >
                Select region…
              </button>
              <button
                data-testid="annotate-start-button"
                type="button"
                style={{ marginTop: 8, marginLeft: 8 }}
                onClick={handleStartAnnotate}
              >
                Annotate…
              </button>
            </div>
          )}

          {captureState.kind === "annotating" && (
            <div style={{ marginTop: 8 }}>
              <AnnotationEditor
                baseImageDataUrl={captureState.cropped ? captureState.cropped.dataUrl : captureState.capture.dataUrl}
                onSubmit={handleAnnotationSubmit}
                onCancel={handleAnnotationCancel}
              />
            </div>
          )}

          {captureState.kind === "annotated" && (
            <div style={{ marginTop: 8 }}>
              <p data-testid="capture-success" style={{ margin: "0 0 4px", fontSize: 13, color: "#1a7f37" }}>
                Annotated screenshot ready ({captureState.annotated.width} x {captureState.annotated.height} px).
              </p>
              <img
                data-testid="annotated-preview"
                src={captureState.annotated.dataUrl}
                alt="Annotated screenshot preview"
                style={{ maxWidth: "100%", border: "1px solid #ddd" }}
              />
              <button
                data-testid="annotate-start-button"
                type="button"
                style={{ marginTop: 8 }}
                onClick={handleStartAnnotate}
              >
                Edit annotations…
              </button>
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

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e5e5e5" }}>
            <button
              data-testid="pick-element-button"
              type="button"
              onClick={handlePickElement}
              disabled={pickState.kind === "picking"}
            >
              {pickState.kind === "picking" ? "Point at an element on the page…" : "Pick element…"}
            </button>

            {pickState.kind === "picking" && (
              <p data-testid="pick-element-hint" style={{ margin: "8px 0 0", fontSize: 13, color: "#666" }}>
                Hover over the page to highlight, click to select, or press Escape to cancel.
              </p>
            )}

            {pickState.kind === "picked" && (
              <div data-testid="pick-element-result" style={{ marginTop: 8, fontSize: 13 }}>
                <p style={{ margin: "0 0 4px", color: "#1a7f37" }}>Element recorded.</p>
                <p style={{ margin: "0 0 2px" }}>
                  Selector: <code data-testid="pick-element-selector">{pickState.result.selector}</code>
                </p>
                <p style={{ margin: "0 0 2px" }}>
                  Confidence: <span data-testid="pick-element-confidence">{pickState.result.confidence}</span>
                </p>
                <p style={{ margin: "0 0 2px" }} data-testid="pick-element-rect">
                  Position/size: {Math.round(pickState.result.rect.x)}, {Math.round(pickState.result.rect.y)} —{" "}
                  {Math.round(pickState.result.rect.width)} x {Math.round(pickState.result.rect.height)} px
                </p>
                <p style={{ margin: 0 }} data-testid="pick-element-viewport">
                  Viewport: {pickState.result.viewport.width} x {pickState.result.viewport.height} px
                </p>
              </div>
            )}

            {pickState.kind === "unsupported" && (
              <p
                data-testid="pick-element-unsupported"
                style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}
              >
                {pickState.reason === "shadow-dom-unsupported"
                  ? "That element is inside a shadow DOM boundary, which isn't supported yet. Try picking a different element."
                  : "That element is inside an iframe, which isn't supported yet. Try picking a different element."}
              </p>
            )}

            {pickState.kind === "cancelled" && (
              <p data-testid="pick-element-cancelled" style={{ margin: "8px 0 0", fontSize: 13, color: "#666" }}>
                Element picking cancelled.
              </p>
            )}

            {pickState.kind === "error" && (
              <p
                data-testid="pick-element-error"
                style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}
              >
                {pickState.reason}
              </p>
            )}
          </div>

          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e5e5e5" }}>
            <button
              data-testid="console-capture-start-button"
              type="button"
              onClick={handleStartConsoleCapture}
              disabled={consoleCaptureState.kind === "starting"}
            >
              {consoleCaptureState.kind === "active"
                ? "Console capture running"
                : consoleCaptureState.kind === "starting"
                  ? "Starting…"
                  : "Start capturing console output"}
            </button>

            <p
              data-testid="console-capture-limitation"
              style={{ margin: "8px 0 0", fontSize: 13, color: "#666" }}
            >
              Only console messages logged after you start capturing are included. Anything
              logged before you clicked "Start capturing console output" — including on page
              load — is not captured.
            </p>

            {consoleCaptureState.kind === "active" && (
              <div style={{ marginTop: 8 }}>
                <button
                  data-testid="console-capture-refresh-button"
                  type="button"
                  onClick={handleRefreshConsoleCapture}
                >
                  Refresh captured logs
                </button>
                <p data-testid="console-capture-count" style={{ margin: "8px 0 4px", fontSize: 13 }}>
                  {consoleCaptureState.entries.length} message
                  {consoleCaptureState.entries.length === 1 ? "" : "s"} captured.
                </p>
                <ul
                  data-testid="console-capture-list"
                  style={{ margin: 0, padding: "0 0 0 16px", fontSize: 12, maxHeight: 160, overflowY: "auto" }}
                >
                  {consoleCaptureState.entries.map((entry, i) => (
                    <li key={i} data-testid="console-capture-entry" data-level={entry.level}>
                      <strong>{entry.level}</strong> ({entry.source}): {entry.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {consoleCaptureState.kind === "error" && (
              <p
                data-testid="console-capture-error"
                style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}
              >
                {consoleCaptureState.reason}
              </p>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
