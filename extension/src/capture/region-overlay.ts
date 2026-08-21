// Follow-up to F283/F284/F285 (superseding AS-539/AS-540 UI flow) — user
// explicitly asked for a "select first, then capture" flow, like macOS's
// Cmd+Shift+4 "Capture Selected Portion", instead of "capture the whole
// tab, then optionally crop inside the popup" (RegionSelect.tsx's old
// flow). `chrome.tabs.captureVisibleTab` (visible-tab.ts) can only ever
// capture the full visible viewport — there is no browser API to capture a
// sub-region directly — so this file only changes the *order* the reporter
// experiences things in: they draw a selection live on the page first,
// then (invisibly, immediately after) a full-tab capture is taken and
// cropped down with the exact same crop.ts math RegionSelect.tsx already
// used. The reporter never sees the full, uncropped tab.
//
// Injection pattern: modeled directly on element-picker.ts's
// `chrome.scripting.executeScript({ func })` + "the injected function
// returns a Promise, executeScript waits for it to settle" pattern — see
// that file's header comment for the full citation
// (https://developer.chrome.com/docs/extensions/reference/api/scripting,
// verified 2026-08-20, still current as of this change per the same docs
// page). No `chrome.tabs.sendMessage` round-trip is needed here either,
// for the same reason.
//
// World choice: ISOLATED (the default `chrome.scripting.executeScript`
// world — no `world` option is passed here, exactly like
// element-picker.ts, which also omits it and runs in ISOLATED). This
// overlay only ever adds/removes its own DOM nodes and listens for its own
// mouse/keyboard events; unlike a hypothetical console/network hook (which
// needed `world: "MAIN"` to patch the *page's own* `console`/`fetch`
// bindings so it could observe calls the page's own JS made — a feature
// that has since been removed from this extension entirely), nothing here
// needs to run inside the page's own JS execution context or intercept the
// page's own global objects. ISOLATED gets its own DOM view of the same
// document (content-script DOM access is shared with the page even in the
// isolated world) with no risk of colliding with or being observed by the
// page's own scripts — the safer, narrower default, matching
// element-picker.ts's own (undocumented-by-omission, now made explicit
// here) choice.
export type RegionOverlayRect = { x: number; y: number; width: number; height: number };

export type RegionOverlayResult =
  // F301 follow-up (region-selection-mid-flow-focus-loss fix): the page's
  // own `window.devicePixelRatio` is captured here, in the injected
  // function's own execution context (the live page), because the caller
  // of `selectRegionOnActiveTab` may now be the background service
  // worker, which has no `window` of its own at all (see
  // `background/service-worker.ts`'s `runRegionCapture`). The page is
  // also architecturally the more correct source for this number anyway —
  // it's the display the selection rect (in CSS pixels) was actually drawn
  // against — not an incidental side effect of who happens to be calling.
  | { ok: true; rect: RegionOverlayRect; devicePixelRatio: number }
  | { ok: false; reason: "cancelled" }
  | { ok: false; reason: string };

/**
 * Self-contained function injected via `chrome.scripting.executeScript`.
 * Runs in the page's own document (isolated world — see file header). Must
 * not reference any variable from the surrounding module scope, same
 * constraint element-picker.ts documents for `runPickerInPage`.
 */
function runRegionOverlayInPage(): Promise<RegionOverlayResult> {
  return new Promise((resolve) => {
    // Bug fix (region-select "wasted first click" follow-up): when this
    // function is injected via `chrome.scripting.executeScript` right
    // after the popup sent `START_REGION_CAPTURE` and (per the F301 fix)
    // is about to close, the tab's own top-level browser window does not
    // necessarily have OS-level window focus yet — the popup (a separate
    // native window) still does, or is only mid-transition to closing.
    // Empirically, the very first real `mousedown` a user makes on the
    // page in that state gets consumed by the OS/browser as the
    // window-activation click (bringing the browser window to the front)
    // rather than being delivered to this overlay's own listeners as a
    // "start dragging" event — the user then has to click a SECOND time,
    // once the window already has focus, for the drag to actually start.
    // Calling `window.focus()` here, synchronously, the instant the
    // overlay is injected (well before the user's first real click can
    // happen) pulls focus onto this tab's document immediately, so by the
    // time the user clicks, the window-activation step has already
    // happened and the click is delivered straight through as a normal
    // `mousedown` the overlay's own listener receives on the first try.
    // This is the standard, documented mitigation for "first click after
    // programmatic/background tab focus doesn't register" in Chrome
    // extensions (window.focus() is safe/no-op if the tab already has
    // focus).
    window.focus();

    const ROOT_ID = "__pm_app_qa_region_overlay_root__";

    // Idempotency: if this was somehow injected twice in a row without a
    // page reload (e.g. a double-click on the popup's trigger button before
    // the first injection's listeners were attached), a stale root from an
    // earlier, never-finished run could otherwise be left behind. Remove
    // any pre-existing root before building a fresh one so there is never
    // more than one overlay's worth of DOM/listeners live at once. (Unlike
    // element-picker.ts's highlight box, which is cheap to reuse in place,
    // this overlay's DOM structure changes shape during a drag, so
    // rebuilding fresh is simpler than trying to reuse a possibly
    // half-finished previous instance.)
    document.getElementById(ROOT_ID)?.remove();

    // F301 follow-up: DOM removal alone is NOT enough idempotency once
    // this function can be re-injected via a background-relayed message
    // (a second "Select area to capture" click while a first attempt is
    // still pending) rather than only ever once per popup-driven call.
    // Removing the DOM node above does not detach the FIRST instance's
    // `document`-level mousedown/mousemove/mouseup/keydown listeners
    // (added below, once per instance) — without this, a second injection
    // would leave two full sets of listeners live at once, and whichever
    // instance's drag the user actually finishes would resolve BOTH the
    // stale first instance's Promise (and thus the stale first background
    // message handler, which would go on to capture+crop+overwrite storage
    // using coordinates that may no longer make sense) and the second's.
    // A page-global cleanup handle — analogous to the ROOT_ID DOM
    // idempotency guard just above, but for the listener/Promise side of
    // the same "only one live overlay instance at a time" invariant —
    // fixes this: force-resolve (as cancelled) and tear down any prior
    // still-live instance before this one attaches its own listeners.
    const CLEANUP_KEY = "__pm_app_qa_region_overlay_cleanup__";
    const win = window as unknown as Record<string, (() => void) | undefined>;
    win[CLEANUP_KEY]?.();

    const root = document.createElement("div");
    root.id = ROOT_ID;
    document.documentElement.appendChild(root);

    // Dimmed full-viewport backdrop — same idea RegionSelect.tsx used for
    // its own dimming (a semi-transparent dark layer), except here it
    // covers the live page instead of a static preview image, and the
    // "cutout" over the selection is done live via updating a box-shadow
    // spread on the selection box itself (see below) rather than a second
    // full-size layer, exactly the technique RegionSelect.tsx documented
    // ("the box-shadow spread trick... dims everything outside it without a
    // second full-size overlay element that would otherwise sit on top of
    // (and block dragging) the selection rect").
    const backdrop = document.createElement("div");
    backdrop.style.position = "fixed";
    backdrop.style.inset = "0";
    backdrop.style.zIndex = "2147483647";
    backdrop.style.background = "rgba(0, 0, 0, 0.25)";
    backdrop.style.cursor = "crosshair";
    root.appendChild(backdrop);

    const selectionBox = document.createElement("div");
    selectionBox.style.position = "fixed";
    selectionBox.style.display = "none";
    selectionBox.style.border = "1px solid #fff";
    selectionBox.style.boxShadow = "0 0 0 9999px rgba(0, 0, 0, 0.45)";
    selectionBox.style.zIndex = "2147483647";
    selectionBox.style.pointerEvents = "none";
    root.appendChild(selectionBox);

    const readout = document.createElement("div");
    readout.style.position = "fixed";
    readout.style.display = "none";
    readout.style.zIndex = "2147483647";
    readout.style.pointerEvents = "none";
    readout.style.background = "#111";
    readout.style.color = "#fff";
    readout.style.font = "12px sans-serif";
    readout.style.padding = "2px 6px";
    readout.style.borderRadius = "3px";
    root.appendChild(readout);

    let dragStart: { x: number; y: number } | null = null;

    function cleanup() {
      document.removeEventListener("mousedown", onMouseDown, true);
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseup", onMouseUp, true);
      document.removeEventListener("keydown", onKeyDown, true);
      // Remove ALL injected DOM immediately — before resolving — so
      // nothing this overlay added can ever appear in a subsequently
      // captured screenshot.
      root.remove();
      // Only clear the page-global cleanup handle if it's still THIS
      // instance's own — a newer instance may have already overwritten it
      // (via the `win[CLEANUP_KEY]?.()` call above, when re-injected while
      // this one was still live), and clobbering that newer handle here
      // would break the newer instance's own idempotency guard.
      if (win[CLEANUP_KEY] === selfCleanup) {
        delete win[CLEANUP_KEY];
      }
    }

    function finish(result: RegionOverlayResult) {
      cleanup();
      resolve(result);
    }

    // Registered as this instance's cleanup handle immediately (before any
    // listeners are attached below) so a THIRD rapid re-injection during
    // this instance's own setup can still find and cancel it correctly.
    function selfCleanup() {
      finish({ ok: false, reason: "cancelled" });
    }
    win[CLEANUP_KEY] = selfCleanup;

    function normalize(a: { x: number; y: number }, b: { x: number; y: number }) {
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const width = Math.abs(b.x - a.x);
      const height = Math.abs(b.y - a.y);
      return { x, y, width, height };
    }

    function onMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      dragStart = { x: e.clientX, y: e.clientY };
      const rect = normalize(dragStart, dragStart);
      updateSelectionUi(rect, e.clientX, e.clientY);
    }

    function onMouseMove(e: MouseEvent) {
      if (!dragStart) return;
      const rect = normalize(dragStart, { x: e.clientX, y: e.clientY });
      updateSelectionUi(rect, e.clientX, e.clientY);
    }

    function updateSelectionUi(
      rect: { x: number; y: number; width: number; height: number },
      cursorX: number,
      cursorY: number,
    ) {
      selectionBox.style.display = "block";
      selectionBox.style.left = `${rect.x}px`;
      selectionBox.style.top = `${rect.y}px`;
      selectionBox.style.width = `${rect.width}px`;
      selectionBox.style.height = `${rect.height}px`;

      readout.style.display = "block";
      readout.style.left = `${cursorX + 12}px`;
      readout.style.top = `${cursorY + 12}px`;
      readout.textContent = `${Math.round(rect.width)} x ${Math.round(rect.height)} px`;
    }

    function onMouseUp(e: MouseEvent) {
      if (!dragStart) return;
      const rect = normalize(dragStart, { x: e.clientX, y: e.clientY });
      dragStart = null;

      if (rect.width <= 0 || rect.height <= 0) {
        // Zero-size selection (a stray click with no drag) — treat as no
        // selection made yet rather than resolving with a useless rect;
        // the overlay stays up so the reporter can try again, matching
        // "click-drag to draw a selection" (a plain click alone never
        // finishes selection).
        selectionBox.style.display = "none";
        readout.style.display = "none";
        return;
      }

      finish({ ok: true, rect, devicePixelRatio: window.devicePixelRatio });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        finish({ ok: false, reason: "cancelled" });
      }
    }

    document.addEventListener("mousedown", onMouseDown, true);
    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseup", onMouseUp, true);
    document.addEventListener("keydown", onKeyDown, true);
  });
}

/**
 * Injects the live-page region-selection overlay onto whichever tab is
 * currently active (via `chrome.scripting.executeScript`, the same
 * `activeTab`-gesture-driven pattern `pickElementOnActiveTab` in
 * element-picker.ts uses — see that file's header) and resolves once the
 * user finishes a drag-selection or presses Escape.
 *
 * F301 follow-up: this function itself references nothing from `window`/
 * `document` at its OWN top level — only `runRegionOverlayInPage` (the
 * separately-injected function above, which always runs inside the page's
 * own document regardless of who called `executeScript`) does. That means
 * this function is safe to call from the background service worker (which
 * has no `window`/`document` of its own), not just from the popup. Per
 * the current Chrome docs
 * (https://developer.chrome.com/docs/extensions/reference/api/permissions#activetab
 * and https://developer.chrome.com/docs/extensions/develop/concepts/activeTab,
 * verified 2026-08-21), the `activeTab` grant is scoped to the (tab,
 * extension) pair for the duration of the tab's page — not to "whichever
 * extension JS context happens to make the API call" — so a grant
 * established by the original user gesture that opened the popup (which
 * IS the qualifying gesture: clicking the extension's toolbar action) is
 * usable by ANY of the extension's own contexts, including the background
 * service worker, right up until the tab navigates or the grant is
 * otherwise revoked. This is exactly what lets `START_REGION_CAPTURE` in
 * `background/service-worker.ts` call this function directly instead of
 * requiring it to run inside the (about to close) popup.
 */
export async function selectRegionOnActiveTab(): Promise<RegionOverlayResult> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Could not find the active tab.",
    };
  }

  if (!tab?.id) {
    return { ok: false, reason: "No active tab available to select a region on." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runRegionOverlayInPage,
    });
    const result = results[0]?.result as RegionOverlayResult | undefined;
    if (!result) {
      return { ok: false, reason: "The region selector did not return a result." };
    }
    return result;
  } catch (err) {
    // Every failure states what happened rather than silently no-opping —
    // e.g. a restricted page (chrome://, the Web Store) where scripting
    // injection is refused even with activeTab.
    return {
      ok: false,
      reason:
        err instanceof Error
          ? err.message
          : "Could not start region selection on this page.",
    };
  }
}
