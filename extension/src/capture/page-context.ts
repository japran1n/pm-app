// F342 — M19 scrutiny BLOCKER-2 fix (AS-548): the page-scoped half of
// environment metadata (URL, viewport size, device pixel ratio) MUST be
// read from the actual page under test, not from the extension popup
// document. `environment.ts`'s `collectEnvironmentMetadata` used to read
// `globalThis.location`/`globalThis.window` directly, which — since it is
// always called from `report-form.tsx`, i.e. code running INSIDE the popup
// document — resolved to the popup's own `chrome-extension://…` URL and its
// ~380px chrome. Browser name/version/OS legitimately stay popup-side (they
// are process-wide, not page-specific — same Chromium renderer either way),
// so only URL/viewport/DPR move here.
//
// This mirrors `element-picker.ts`'s already-correct, already-shipped
// pattern exactly: resolve the currently active tab via
// `chrome.tabs.query({ active: true, currentWindow: true })`, then inject a
// small self-contained function into that tab's own page context via
// `chrome.scripting.executeScript`. Same permission story as the picker —
// `activeTab` (per-gesture host access) + the `scripting` permission
// already declared in the manifest; no new `host_permissions` entry needed.
//
// Like `pickElementOnActiveTab`, `runReadPageContextInPage` below cannot
// close over anything from this module's outer scope (the injected `func`
// is serialized and run in an isolated world) — it only reads plain page
// globals (`window.location`, `window.innerWidth/innerHeight`,
// `window.devicePixelRatio`), so there is nothing to duplicate here beyond
// those three one-line reads.
//
// Failure handling: any failure (no active tab, injection rejected e.g. on
// a `chrome://` page the extension cannot script) resolves to `null` rather
// than throwing — the caller (`report-form.tsx`) falls back to
// `collectEnvironmentMetadata`'s own popup-scoped resolution in that case,
// which is a real degraded case (see that module's own fallback resolvers)
// but never blocks report submission.

export type PageContext = {
  pageUrl: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
};

/**
 * Self-contained function injected via `chrome.scripting.executeScript`.
 * Runs in the target tab's own page context — must not reference any
 * variable from the surrounding module scope.
 */
function runReadPageContextInPage(): PageContext {
  return {
    pageUrl: window.location.href,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
  };
}

/**
 * Reads real, page-scoped URL/viewport/DPR from whichever tab is currently
 * active, via the same `chrome.scripting.executeScript` mechanism
 * `element-picker.ts` already uses. Returns `null` (never throws) if no
 * active tab could be resolved or injection failed — the caller is
 * responsible for falling back gracefully.
 */
export async function collectPageContextOnActiveTab(): Promise<PageContext | null> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch {
    return null;
  }

  if (!tab?.id) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runReadPageContextInPage,
    });
    const result = results[0]?.result as PageContext | undefined;
    return result ?? null;
  } catch {
    return null;
  }
}
