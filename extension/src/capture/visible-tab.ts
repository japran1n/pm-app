// F283 — AS-539, AS-541: capture the currently visible tab from the popup.
//
// `chrome.tabs.captureVisibleTab` must be called synchronously-ish from a
// real user gesture inside the action popup — not the background service
// worker, not a side panel — because `activeTab` (the permission the
// manifest declares, granted per click on the extension action) is
// documented as reliable only from that surface. See
// https://developer.chrome.com/docs/extensions/reference/api/tabs
// (captureVisibleTab, activeTab sections) as of 2026-08-19, also noted in
// missions/20260818-213033/tech-decisions.md § "QA feedback extension".
//
// Signature (current MV3 API, verified against the same docs):
//   chrome.tabs.captureVisibleTab(windowId?: number, options?: { format?:
//   "jpeg" | "png"; quality?: number }): Promise<string>
// It resolves with a data URL. On a page it cannot capture (chrome://,
// the Chrome Web Store, other extensions' pages, or any page the
// `activeTab` grant does not cover) it rejects — surfaced here as a thrown
// error / populated `chrome.runtime.lastError` — rather than resolving
// with empty/garbage data.
export type CaptureResult =
  | {
      ok: true;
      dataUrl: string;
      // Physical-pixel image vs. CSS-pixel layout: captureVisibleTab
      // returns the PNG at the OS's physical pixel density, but anything
      // that later needs to place an overlay (e.g. an annotation feature)
      // works in CSS pixels. Recording `window.devicePixelRatio` here
      // (the popup document's own ratio, which reflects the display the
      // captured window is on) means a later feature can convert without
      // having to rediscover this number — see the decisions section of
      // the F283 handoff for why this is captured now rather than punted.
      devicePixelRatio: number;
      capturedAt: number;
    }
  | {
      ok: false;
      // Always a human-readable explanation of *why* capture failed,
      // never a bare "failed" — AS-541. Includes the underlying Chrome
      // error text (when available) plus, for the known restricted-page
      // case, a stated reason so the user isn't left guessing.
      reason: string;
    };

function explainCaptureError(err: unknown, sawTabUrl: boolean): string {
  const rawMessage =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Unknown error from chrome.tabs.captureVisibleTab.";

  // `activeTab` deliberately never exposes a `url` for chrome://, the Web
  // Store, other extensions' pages, or any other browser-internal
  // surface — Chrome withholds it from the extension entirely, even after
  // the user has clicked the extension's own action on that tab (see
  // https://developer.chrome.com/docs/extensions/develop/concepts/activeTab
  // "restrictions", verified 2026-08-19). So a `chrome.tabs.query` for the
  // active tab that comes back with no `url` at all is itself the
  // deterministic signal that this is one of those restricted pages —
  // capture there is not just unlikely to work, it is architecturally
  // impossible, regardless of any permission this extension could ever be
  // granted. Naming that explicitly (rather than reusing the generic
  // "no permission yet" message below) is what AS-541 asks for.
  if (!sawTabUrl) {
    return (
      `Can't capture this page: Chrome blocks extensions from capturing ` +
      `browser-internal pages (chrome://, the Chrome Web Store, or other ` +
      `extensions' pages) — this is a Chrome security restriction, not a ` +
      `setting you can change here. Switch to a regular website tab and ` +
      `capture from there instead. (Chrome said: ${rawMessage})`
    );
  }

  return (
    `Can't capture this tab: ${rawMessage}. This usually means the ` +
    `extension wasn't granted access to the current tab — click the ` +
    `extension icon again on the tab you want to capture, then try once more.`
  );
}

/**
 * Captures the visible area of the active tab in the current window as a
 * PNG. Must be called soon enough after the qualifying user gesture (the
 * click that opened the extension's popup) for the `activeTab` grant to
 * still be in effect — but not necessarily FROM the popup itself; see
 * `region-overlay.ts`'s `selectRegionOnActiveTab` doc comment for the
 * `activeTab` grant-scope citation this also relies on.
 *
 * F301 follow-up: this function is genuinely context-agnostic now — it no
 * longer reads `window.devicePixelRatio` itself (the background service
 * worker that now also calls this has no `window` at all). The caller
 * supplies `devicePixelRatio` explicitly; `background/service-worker.ts`
 * passes the PAGE's own ratio (captured by `region-overlay.ts`'s injected
 * function, in the page's real execution context) rather than the popup's,
 * which is both more correct (it's the display the selection was actually
 * drawn against) and the only option available from a worker with no
 * `window` of its own. Falls back to `1` only if the caller omits it
 * entirely (kept for defensive robustness; every real call site now always
 * supplies a real value).
 */
export async function captureVisibleTab(
  options: { devicePixelRatio?: number } = {},
): Promise<CaptureResult> {
  let sawTabUrl = false;
  try {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    sawTabUrl = typeof activeTab?.url === "string" && activeTab.url.length > 0;

    const dataUrl = await chrome.tabs.captureVisibleTab({
      format: "png",
    });

    if (!dataUrl) {
      throw new Error("chrome.tabs.captureVisibleTab returned no data.");
    }

    return {
      ok: true,
      dataUrl,
      devicePixelRatio: options.devicePixelRatio ?? 1,
      capturedAt: Date.now(),
    };
  } catch (err) {
    return { ok: false, reason: explainCaptureError(err, sawTabUrl) };
  }
}
