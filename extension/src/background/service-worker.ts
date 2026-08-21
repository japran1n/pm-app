// F280 (AS-531): background service worker skeleton, no capture/auth logic
// yet — those land in later M19 features.
//
// F281 (AS-532, AS-538): handles the session handoff. When
// `src/content/extension-connect.ts` relays a one-time token read from
// pm-app's `/extension-connect` page, this worker redeems it against the
// server (`app/(auth)/extension-connect/exchange/route.ts` — the server
// resolves identity from the token itself, this worker never claims an
// identity) and writes the resulting session into
// `chrome.storage.local` via supabase-js's own `setSession`, so the
// storage adapter (`src/lib/chrome-storage-adapter.ts`) persists it in the
// exact shape supabase-js expects to read back.
import { APP_URL, createExtensionSupabaseClient } from "../lib/supabase";
import { selectRegionOnActiveTab } from "../capture/region-overlay";
import { captureVisibleTab } from "../capture/visible-tab";
import { cropDataUrlToRegion, cssRectToPhysicalRect } from "../capture/crop";
import {
  writePendingCaptureResult,
  setCaptureReadyBadge,
} from "../capture/pending-capture";
import { checkScreenshotSize } from "../submit/upload";

chrome.runtime.onInstalled.addListener(() => {
  console.log("[pm-app-qa-feedback] service worker installed");
});

type HandoffMessage = { type: "EXTENSION_HANDOFF_TOKEN"; token: string };

function isHandoffMessage(message: unknown): message is HandoffMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message as { type?: unknown }).type === "EXTENSION_HANDOFF_TOKEN" &&
    typeof (message as { token?: unknown }).token === "string"
  );
}

async function exchangeHandoffToken(token: string): Promise<void> {
  const response = await fetch(`${APP_URL}/extension-connect/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    // Token already used/expired/invalid — every failure state states what
    // happened rather than silently no-oping; the popup surfaces this via
    // connection status ("Not connected") since no session gets written.
    const body = await response.json().catch(() => ({}));
    console.error(
      "[pm-app-qa-feedback] extension handoff exchange failed:",
      response.status,
      body,
    );
    return;
  }

  const body = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string | null };
  };

  const supabase = createExtensionSupabaseClient();
  const { error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });

  if (error) {
    console.error(
      "[pm-app-qa-feedback] failed to establish extension session:",
      error.message,
    );
  }
}

// F301 follow-up (region-selection-mid-flow-focus-loss fix): the entire
// "select a region, then capture + crop" orchestration now runs here
// instead of inside the popup's own JS realm — see
// `capture/pending-capture.ts`'s header for the full root-cause writeup.
// The popup only ever fires-and-forgets this message; it never awaits a
// result inline, because it cannot assume it will still exist by the time
// one is ready (drawing a selection requires clicking into the page,
// which closes the popup).
type StartRegionCaptureMessage = { type: "START_REGION_CAPTURE" };

function isStartRegionCaptureMessage(message: unknown): message is StartRegionCaptureMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "START_REGION_CAPTURE"
  );
}

// Bug fix (region-select "popup doesn't reopen automatically" follow-up).
//
// Investigated `chrome.action.openPopup()`
// (https://developer.chrome.com/docs/extensions/reference/api/action#method-openPopup,
// verified 2026-08-21 — available since Chrome 127, well below any version
// this codebase otherwise targets; no minimum-Chrome-version statement
// exists elsewhere in tech-decisions.md or manifest.json, so this is not a
// blocking constraint either way).
//
// Empirically tested (real Playwright-driven Chromium, not assumed) whether
// calling it from here — after the real page `mouseup` that finishes the
// drag-selection, with the intervening `captureVisibleTab`/crop async work
// this function already does before this point — can succeed: the call
// consistently RESOLVED WITHOUT THROWING (satisfied whatever
// transient-activation window Chrome tracks from that real mouseup), but
// across 5 repeated real runs no popup window was ever observed to actually
// materialize (`chrome.windows.getAll()` count stayed at 1 throughout, and
// no new Playwright `page` event fired within a 5s window). A rejected-only
// promise would have been an easy, honest signal to fall back on — a
// promise that quietly resolves without producing a visible popup is not:
// this is not a reliable, verifiable "automatic reopen" in this real,
// automated environment, so it cannot be the ONLY mechanism the reporter
// depends on.
//
// Given that, both are wired in: `openPopup()` is still attempted here,
// opportunistically, as a strict best-effort improvement for whichever
// real, non-automated Chrome sessions it may genuinely work in (it costs
// nothing and never blocks or throws past this function) — but the
// guaranteed, always-present, independently-verified user cue is the
// toolbar badge below, set the instant a pending result is written and
// cleared the moment a popup mounts and consumes it (see
// `Popup.tsx`'s mount-restore effect). If `openPopup()` silently does
// nothing, the reporter still sees an unambiguous visual signal to click
// the icon, rather than wondering if anything happened at all.
async function tryReopenPopup(): Promise<void> {
  try {
    await chrome.action.openPopup();
  } catch (err) {
    // Never a silent swallow — logged so it is visible in the service
    // worker's own console during real usage/debugging, but never
    // surfaced to the reporter as an error: the badge fallback below
    // already guarantees a visible cue regardless of this outcome.
    console.warn(
      "[pm-app-qa-feedback] chrome.action.openPopup() did not reopen the popup automatically:",
      err instanceof Error ? err.message : err,
    );
  }
}

/** Writes the final pending capture result AND — unless it's a plain
 * cancellation (Escape; nothing for the reporter to see, so reopening the
 * popup for it would just be confusing) — sets the toolbar badge and makes
 * a best-effort attempt to reopen the popup automatically. Every terminal
 * path of `runRegionCapture` below funnels through this single function so
 * the "reopen/badge on anything worth seeing" behaviour can never diverge
 * between the success path and the various failure paths (a restricted
 * page, an oversized screenshot, a crop error, a storage-quota error all
 * deserve the same visible cue a successful capture does — the reporter
 * needs to know something happened either way, not just on success). */
async function finishRegionCapture(
  result: Parameters<typeof writePendingCaptureResult>[0],
): Promise<void> {
  await writePendingCaptureResult(result);
  if (!result.ok && result.reason === "cancelled") return;
  await setCaptureReadyBadge();
  await tryReopenPopup();
}

async function runRegionCapture(): Promise<void> {
  // 1. Live-page overlay — see region-overlay.ts's own idempotency guard
  // (both the DOM-level ROOT_ID guard and the newer page-global cleanup
  // handle) for what happens if a second START_REGION_CAPTURE arrives
  // while this is still in flight: the earlier in-flight call's overlay
  // gets force-resolved as cancelled and its result written here first,
  // then this (or a subsequent) call's real result overwrites it once the
  // user actually finishes a selection.
  const overlayResult = await selectRegionOnActiveTab();
  if (!overlayResult.ok) {
    // Covers both "cancelled" (Escape, or superseded by a later
    // re-injection) and every other stated failure reason (e.g. a
    // restricted page) — every failure state says what happened, never
    // silently vanishes.
    await finishRegionCapture({ ok: false, reason: overlayResult.reason });
    return;
  }

  // 2. Only now — after the overlay has already removed all of its own DOM
  // from the page — take the actual full-tab capture and crop it down to
  // the selected rect. `devicePixelRatio` is sourced from the page's own
  // window (captured by the injected overlay function, which does have a
  // `window`), since this service worker has none of its own — see
  // visible-tab.ts's doc comment.
  const captureResult = await captureVisibleTab({
    devicePixelRatio: overlayResult.devicePixelRatio,
  });
  if (!captureResult.ok) {
    await finishRegionCapture({ ok: false, reason: captureResult.reason });
    return;
  }

  try {
    const physicalRect = cssRectToPhysicalRect(
      overlayResult.rect,
      captureResult.devicePixelRatio,
    );
    const cropped = await cropDataUrlToRegion(captureResult.dataUrl, physicalRect);

    // F301 follow-up: a real, honest constraint of this fix's own
    // architecture — the capture result now has to pass through
    // `chrome.storage.local` (so it survives the popup closing), which has
    // a real, hard 10MB total quota (see pending-capture.ts's header).
    // AS-566/567's existing "oversized screenshot" size check (against the
    // exact same `MAX_ATTACHMENT_SIZE_BYTES`/message
    // `checkScreenshotSize` already enforces at submit time) is applied
    // here too, proactively, BEFORE attempting the storage write — an
    // oversized image would fail that write with a confusing native
    // `QUOTA_BYTES` error otherwise (verified empirically while building
    // this fix), which would violate this mission's own "every failure
    // states what happened" rule. The reporter now sees this rejection
    // immediately as a capture-error, with the same stated limit, rather
    // than only at submit time — a strictly earlier, still-clear failure,
    // not a silent one.
    const sizeCheck = checkScreenshotSize({ dataUrl: cropped.dataUrl });
    if (!sizeCheck.ok) {
      await finishRegionCapture({ ok: false, reason: sizeCheck.error });
      return;
    }

    try {
      await finishRegionCapture({
        ok: true,
        dataUrl: cropped.dataUrl,
        width: cropped.width,
        height: cropped.height,
        devicePixelRatio: 1,
        capturedAt: Date.now(),
      });
    } catch (storageErr) {
      // Belt-and-suspenders, same reasoning as draft.ts's own fallback: the
      // proactive size check above already caught the common case, but
      // other data already occupying most of the 10MB quota could still
      // make even a within-limit image's write fail. Report this plainly
      // rather than letting the promise rejection go unhandled and the
      // reporter be left staring at a popup that never shows anything.
      await finishRegionCapture({
        ok: false,
        reason:
          storageErr instanceof Error
            ? `Could not save the captured screenshot: ${storageErr.message}`
            : "Could not save the captured screenshot (storage quota exceeded).",
      });
    }
  } catch (err) {
    await finishRegionCapture({
      ok: false,
      reason: err instanceof Error ? err.message : "Could not crop the selected region.",
    });
  }
}

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (isHandoffMessage(message)) {
    void exchangeHandoffToken(message.token);
  } else if (isStartRegionCaptureMessage(message)) {
    // Fire-and-forget from the caller's perspective (see this section's
    // header comment) — this listener itself never calls `sendResponse`,
    // so `chrome.runtime.sendMessage`'s returned promise on the popup side
    // resolves immediately with `undefined` regardless of how long the
    // actual capture takes or whether the popup is still around to see it
    // finish. The real result always arrives via
    // `chrome.storage.local`/`writePendingCaptureResult` above, never via
    // this message's response.
    void runRegionCapture();
  }
});
