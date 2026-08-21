import { useEffect, useRef, useState } from "react";

import { APP_URL, createExtensionSupabaseClient } from "../lib/supabase";
import { captureVisibleTab } from "../capture/visible-tab";
import { setLastCapture, setAnnotatedResult } from "../capture/store";
import { selectRegionOnActiveTab } from "../capture/region-overlay";
import { cropDataUrlToRegion, cssRectToPhysicalRect } from "../capture/crop";
import type { CropResult } from "../capture/crop";
import { AnnotationEditor } from "../annotate/canvas";
import type { FlattenResult } from "../annotate/types";
import { pickElementOnActiveTab, type PickResult } from "../capture/element-picker";
import { ReportForm } from "./report-form";

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
// F293 (AS-555, AS-556, AS-557): "connected" now also carries the current
// session's access_token — the report form needs it for the
// `Authorization: Bearer <access_token>` header on both
// GET /api/extension/context and POST /api/extension/tasks. Sourced from
// the exact same getSession()/onAuthStateChange session objects that
// already determine "connected" below — never re-derived or cached
// separately, so it's always the same token the popup itself is currently
// relying on (including after F282's silent refresh rewrites it).
// F295: "connected" now also carries the session's user id, alongside the
// email it already carried — describe.ts's environment-metadata collection
// needs both to fill in the reporter identity fields (see
// capture/environment.ts's `ReporterIdentity`), sourced from the exact same
// getSession()/onAuthStateChange session objects as email/accessToken
// already are, never re-derived separately.
type Status =
  | { kind: "loading" }
  | { kind: "connected"; email: string | null; userId: string; accessToken: string }
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

  // Follow-up to F283/F284/F285 (superseding the old "capture whole tab,
  // then optionally crop inside the popup" two-step flow): the ONLY capture
  // mode now is "select the region live on the page first, then capture +
  // crop happens invisibly right after" — like macOS's Cmd+Shift+4. There
  // is no more "keep the whole tab" fallback; the reporter always ends up
  // with a cropped region, and never sees a flash of the full uncropped
  // tab. Capture state is still independent of connection status — it
  // needs only `activeTab`/`scripting`, not an authenticated session (auth
  // only matters once the task is actually filed) — and is still kept
  // local to this component (not chrome.storage), since it only needs to
  // survive the current popup mount.
  //
  // Flow: "selecting" (the live-page overlay from region-overlay.ts is
  // open and driving its own Promise) -> "capturing" (overlay resolved
  // with a rect; captureVisibleTab() + cropDataUrlToRegion() are running)
  // -> "cropped" (the only screenshot state the reporter ever sees).
  //
  // F285 (AS-542, AS-543, AS-545) still applies unchanged from here: once
  // cropped, the user can open the annotation editor ("annotating").
  // Confirming annotations produces "annotated": the flattened PNG
  // replaces what's shown/held for the next stage; the pristine cropped
  // image is never shown again once annotations exist (AS-545).
  type CaptureUiState =
    | { kind: "idle" }
    | { kind: "selecting" }
    | { kind: "capturing" }
    | { kind: "cropped"; cropped: CropResult }
    | { kind: "annotating"; cropped: CropResult }
    | { kind: "annotated"; cropped: CropResult; annotated: FlattenResult }
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

  async function handleSelectRegion() {
    setCaptureState({ kind: "selecting" });

    // 1. Live-page overlay: the reporter draws a selection rectangle
    // directly on the page they're reporting a bug on (region-overlay.ts).
    // Nothing is captured yet.
    const overlayResult = await selectRegionOnActiveTab();
    if (!overlayResult.ok) {
      if (overlayResult.reason === "cancelled") {
        setCaptureState({ kind: "idle" });
      } else {
        setCaptureState({ kind: "error", reason: overlayResult.reason });
      }
      return;
    }

    // 2. Only now — after the overlay has already removed all of its own
    // DOM from the page — take the actual full-tab capture
    // (chrome.tabs.captureVisibleTab can only ever capture the full
    // visible viewport; there is no browser API for a sub-region capture)
    // and immediately crop it down to the selected rect. The reporter
    // never sees this intermediate full-tab image.
    setCaptureState({ kind: "capturing" });
    const captureResult = await captureVisibleTab();
    if (!captureResult.ok) {
      setCaptureState({ kind: "error", reason: captureResult.reason });
      return;
    }

    try {
      const physicalRect = cssRectToPhysicalRect(
        overlayResult.rect,
        captureResult.devicePixelRatio,
      );
      const cropped = await cropDataUrlToRegion(captureResult.dataUrl, physicalRect);
      // AS-566/AS-567 fallback path (report-form.tsx's getLastCapture()):
      // must be the cropped result, not the full uncropped tab — the
      // reporter never sees, and must never submit, the intermediate
      // full-tab image. devicePixelRatio is recorded as 1 here since
      // `cropped.dataUrl` is already in the crop's own final physical-pixel
      // space; nothing downstream re-derives physical pixels from it again.
      setLastCapture({ ok: true, dataUrl: cropped.dataUrl, devicePixelRatio: 1, capturedAt: Date.now() });
      setCaptureState({ kind: "cropped", cropped });
    } catch (err) {
      setCaptureState({
        kind: "error",
        reason: err instanceof Error ? err.message : "Could not crop the selected region.",
      });
    }
  }

  function handleStartAnnotate() {
    if (captureState.kind === "cropped") {
      setCaptureState({ kind: "annotating", cropped: captureState.cropped });
    }
  }

  function handleAnnotationSubmit(result: FlattenResult) {
    if (captureState.kind !== "annotating") return;
    // AS-545: the flattened annotated PNG — not the pristine cropped image
    // underneath it — is what's held for the next stage.
    setAnnotatedResult(result);
    setCaptureState({
      kind: "annotated",
      cropped: captureState.cropped,
      annotated: result,
    });
  }

  function handleAnnotationCancel() {
    if (captureState.kind !== "annotating") return;
    setCaptureState({ kind: "cropped", cropped: captureState.cropped });
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
        if (session?.access_token) {
          setStatus({
            kind: "connected",
            email: session.user.email ?? null,
            userId: session.user.id,
            accessToken: session.access_token,
          });
        }
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
        setStatus({
          kind: "connected",
          email: data.session.user.email ?? null,
          userId: data.session.user.id,
          accessToken: data.session.access_token,
        });
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
    <main
      data-testid="popup-root"
      style={{ padding: "var(--pm-space-4)", minWidth: 380, fontFamily: "var(--pm-font-family)" }}
    >
      <h1 className="pm-heading" style={{ margin: "0 0 var(--pm-space-3)" }}>
        PM-App QA Feedback
      </h1>

      {status.kind === "loading" && (
        <p data-testid="connection-status" className="pm-meta" style={{ margin: 0 }}>
          Checking connection&hellip;
        </p>
      )}

      {status.kind === "connected" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--pm-space-3)" }}>
          <p
            data-testid="connection-status"
            className="pm-body"
            style={{ margin: 0, color: "var(--pm-success)", display: "flex", alignItems: "center" }}
          >
            <span className="pm-status-dot" style={{ background: "var(--pm-success)" }} aria-hidden="true" />
            Connected{status.email ? ` as ${status.email}` : ""}
          </p>
          <button
            className="pm-btn pm-btn-secondary"
            data-testid="disconnect-button"
            type="button"
            onClick={disconnect}
          >
            Disconnect
          </button>
        </div>
      )}

      {status.kind === "expired" && (
        <>
          <p
            data-testid="connection-status"
            className="pm-body"
            style={{ margin: "0 0 var(--pm-space-1)", color: "var(--pm-error)", display: "flex", alignItems: "center" }}
          >
            <span className="pm-status-dot" style={{ background: "var(--pm-error)" }} aria-hidden="true" />
            Not connected
          </p>
          <p
            data-testid="signed-out-reason"
            className="pm-meta"
            style={{ margin: "0 0 var(--pm-space-3)", color: "var(--pm-error)" }}
          >
            Session expired. Please reconnect.
          </p>
          <button
            className="pm-btn pm-btn-primary"
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
          <p
            data-testid="connection-status"
            className="pm-body"
            style={{ margin: "0 0 var(--pm-space-1)", color: "var(--pm-text-secondary)", display: "flex", alignItems: "center" }}
          >
            <span className="pm-status-dot" style={{ background: "var(--pm-text-secondary)" }} aria-hidden="true" />
            Not connected
          </p>
          <p className="pm-meta" style={{ margin: "0 0 var(--pm-space-3)" }}>
            Sign in to pm-app, then connect the extension to your account.
          </p>
          <button
            className="pm-btn pm-btn-primary"
            data-testid="connect-button"
            type="button"
            onClick={openConnectFlow}
          >
            Sign in to connect
          </button>
        </>
      )}

      {status.kind !== "loading" && (
        <div className="pm-section">
          <button
            className="pm-btn pm-btn-primary"
            data-testid="capture-button"
            type="button"
            onClick={handleSelectRegion}
            disabled={captureState.kind === "selecting" || captureState.kind === "capturing"}
            style={{ width: "100%" }}
          >
            {captureState.kind === "selecting"
              ? "Draw a selection on the page…"
              : captureState.kind === "capturing"
                ? "Capturing…"
                : "Select area to capture"}
          </button>

          {captureState.kind === "selecting" && (
            <p data-testid="capture-selecting-hint" style={{ margin: "8px 0 0", fontSize: 13, color: "#666" }}>
              Click-drag on the page to select the area to capture, or press Escape to cancel.
            </p>
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
                data-testid="annotate-start-button"
                type="button"
                style={{ marginTop: 8 }}
                onClick={handleStartAnnotate}
              >
                Annotate…
              </button>
            </div>
          )}

          {captureState.kind === "annotating" && (
            <div style={{ marginTop: 8 }}>
              <AnnotationEditor
                baseImageDataUrl={captureState.cropped.dataUrl}
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

          {/* F293 (AS-555, AS-556, AS-557): the actual report form —
              workspace/project/status/title/description/assignee/priority/
              due-date — wired to F292's real task-creation endpoint. Only
              rendered when connected, since it needs a real access_token
              for its Authorization header. F294 (AS-559, AS-566, AS-567):
              on submit, the form itself (not this component) reads
              whichever screenshot state exists in capture/store.ts
              (annotated, falling back to the plain capture) and uploads it
              to the just-created task — see report-form.tsx's doc comment.
              Console/network capture support has been removed entirely
              (not needed). */}
          {status.kind === "connected" && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e5e5e5" }}>
              <h2 style={{ fontSize: 14, margin: "0 0 8px" }}>Report</h2>
              <ReportForm
                accessToken={status.accessToken}
                reporterId={status.userId}
                reporterEmail={status.email}
                pickedElement={pickState.kind === "picked" ? pickState.result : null}
              />
            </div>
          )}
        </div>
      )}
    </main>
  );
}
