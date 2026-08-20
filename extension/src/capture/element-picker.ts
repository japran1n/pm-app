// F287 — AS-546, AS-547: let the reporter hover over and click an element
// on WHATEVER page they're currently looking at, and record which element
// they mean.
//
// Permission pattern (verified against the current MV3
// `chrome.scripting` docs, https://developer.chrome.com/docs/extensions/reference/api/scripting,
// section "Permissions", checked 2026-08-20): `chrome.scripting.executeScript`
// needs the *content*-injection host access, which `activeTab` alone
// supplies for whichever tab the user just interacted with the extension
// action on (activeTab implicitly grants scripting-into-the-current-tab
// for the duration of that gesture, with no host_permissions entry and no
// `<all_urls>`) — **but** the `scripting` permission itself must still be
// declared in the manifest for the `chrome.scripting` namespace to exist
// at all; `activeTab` grants the *host access* the call needs, not the API
// surface. Both are already narrow, per-gesture grants — no new
// `host_permissions` entry was added (see manifest.json diff in this
// feature's commit and the handoff's Decisions Made).
//
// Flow: popup button click (the user gesture that grants activeTab for
// this tab) -> `pickElementOnActiveTab()` resolves the active tab and
// calls `chrome.scripting.executeScript` with a self-contained `func` ->
// the injected function adds real `mousemove`/`click`/`keydown` listeners
// to the live page and returns a *Promise* that only resolves once the
// user clicks (or presses Escape) -> `chrome.scripting.executeScript`
// itself waits for that promise to settle and hands its resolved value
// straight back as the call's result (no `chrome.tabs.sendMessage`
// round-trip needed — verified against the same docs page, "If the
// injected script returns a Promise, the implementation waits for the
// promise to settle" is the documented current behaviour of the
// MV3 `chrome.scripting.executeScript` API and is the cleaner pattern
// here since there is nothing else the popup needs to do until then).
//
// Injected-code duplication note: `chrome.scripting.executeScript`'s
// `func` parameter is serialized and executed in an isolated world with NO
// closure over this module's other imports — it can only call helper
// functions declared *inside its own function body*. `runPickerInPage`
// below therefore contains a small, deliberately duplicated copy of
// `selector.ts`'s tiered selector-generation logic. `selector.ts` remains
// the canonical, unit-tested version (used both to document the
// confidence scheme and to prove the algorithm correct against real DOM
// structures in isolation); this copy is kept in lock-step with it by
// comment cross-reference. This is a known, accepted tradeoff of the
// `chrome.scripting.executeScript({ func })` pattern versus injecting a
// separate compiled file via `files: [...]` — `func` was chosen because it
// needs no extra build-time bundle target and keeps the whole picker
// self-contained in one place for review.

export type SelectorConfidence = "id" | "data-attribute" | "nth-of-type-path";

export type PickedElementRecord = {
  ok: true;
  selector: string;
  confidence: SelectorConfidence;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number };
};

export type PickCancelled = { ok: false; reason: "cancelled" };
export type PickUnsupported = {
  ok: false;
  reason: "shadow-dom-unsupported" | "iframe-unsupported";
};
export type PickFailed = { ok: false; reason: string };

export type PickResult = PickedElementRecord | PickCancelled | PickUnsupported | PickFailed;

/**
 * Self-contained function injected via `chrome.scripting.executeScript`.
 * Runs in the page's own (isolated-world) context. Must not reference any
 * variable from the surrounding module scope — see the file header.
 */
function runPickerInPage(): Promise<PickResult> {
  return new Promise((resolve) => {
    const HIGHLIGHT_ID = "__pm_app_qa_element_picker_highlight__";

    let highlightEl = document.getElementById(HIGHLIGHT_ID);
    if (!highlightEl) {
      highlightEl = document.createElement("div");
      highlightEl.id = HIGHLIGHT_ID;
      highlightEl.style.position = "fixed";
      highlightEl.style.zIndex = "2147483647";
      highlightEl.style.pointerEvents = "none";
      highlightEl.style.border = "2px solid #2563eb";
      highlightEl.style.backgroundColor = "rgba(37, 99, 235, 0.15)";
      highlightEl.style.display = "none";
      document.documentElement.appendChild(highlightEl);
    }

    function cleanup() {
      document.removeEventListener("mousemove", onMouseMove, true);
      document.removeEventListener("mouseover", onMouseOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      highlightEl?.remove();
    }

    function moveHighlightTo(el: Element) {
      const rect = el.getBoundingClientRect();
      if (!highlightEl) return;
      highlightEl.style.display = "block";
      highlightEl.style.left = `${rect.left}px`;
      highlightEl.style.top = `${rect.top}px`;
      highlightEl.style.width = `${rect.width}px`;
      highlightEl.style.height = `${rect.height}px`;
    }

    // Duplicated from selector.ts's tiered algorithm (see file header for
    // why this can't just import it). Keep in lock-step with that file.
    function cssEscape(value: string): string {
      if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(value);
      }
      return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
    }

    function isUnique(selector: string): boolean {
      try {
        return document.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    }

    function generateSelectorInPage(
      el: Element,
    ): { selector: string; confidence: SelectorConfidence } {
      if (el.id) {
        const idSel = `#${cssEscape(el.id)}`;
        if (isUnique(idSel)) return { selector: idSel, confidence: "id" };
      }

      const tag = el.tagName.toLowerCase();
      const dataAttrNames = Array.from(el.attributes)
        .map((a) => a.name)
        .filter((name) => name.startsWith("data-"))
        .sort((a, b) => (a === "data-testid" ? -1 : b === "data-testid" ? 1 : 0));
      for (const name of dataAttrNames) {
        const value = el.getAttribute(name);
        if (!value) continue;
        const safeValue = value.replace(/["\\]/g, (ch) => `\\${ch}`);
        const dataSel = `${tag}[${name}="${safeValue}"]`;
        if (isUnique(dataSel)) return { selector: dataSel, confidence: "data-attribute" };
      }

      const parts: string[] = [];
      let current: Element | null = el;
      while (current) {
        if (current.id) {
          parts.unshift(`#${cssEscape(current.id)}`);
          break;
        }
        const t = current.tagName.toLowerCase();
        const parent: Element | null = current.parentElement;
        if (!parent) {
          parts.unshift(t);
          break;
        }
        const siblings = Array.from(parent.children).filter(
          (s) => s.tagName === current!.tagName,
        );
        const idx = siblings.indexOf(current) + 1;
        parts.unshift(siblings.length > 1 ? `${t}:nth-of-type(${idx})` : t);
        current = parent;
      }
      return { selector: parts.join(" > "), confidence: "nth-of-type-path" };
    }

    function isInsideShadowDom(el: Element): boolean {
      const root = el.getRootNode();
      return typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot;
    }

    function realTargetOf(e: MouseEvent): Element | null {
      // composedPath()[0] is the innermost real target even when it lives
      // inside an (open) shadow root, unlike e.target which the DOM
      // retargets to the shadow host for listeners outside the tree.
      const path = typeof e.composedPath === "function" ? e.composedPath() : [];
      const first = path.find((n): n is Element => n instanceof Element);
      return first ?? (e.target instanceof Element ? e.target : null);
    }

    function onMouseMove(e: MouseEvent) {
      const target = realTargetOf(e);
      if (!target || target === highlightEl) return;
      moveHighlightTo(target);
    }

    function finish(result: PickResult) {
      cleanup();
      resolve(result);
    }

    // AS-546/AS-547 + clarified "simpler, more private option": verified
    // empirically (see this feature's handoff "Notes for the next
    // worker") that mouse events for coordinates *inside* an <iframe>'s
    // box are delivered only to the iframe's own document — the top
    // frame (where this script runs) never receives `mousemove` or
    // `click` for them at all, same-origin or not, so a real click
    // landing inside an iframe can never be observed here to react to at
    // click-time. What the top frame *does* reliably receive is a
    // `mouseover` transition onto the <iframe> element itself the moment
    // the pointer enters its box (ordinary DOM hit-testing treats an
    // iframe as an opaque element from the ancestor document's point of
    // view). Since no click inside the iframe could ever be distinguished
    // from "the user moved on to something else" without ending the
    // picker right here, entering an iframe's box concludes picking
    // immediately with the explicit unsupported reason — matching the
    // "never a silent no-op" requirement, since waiting indefinitely for
    // a click event that structurally cannot arrive would otherwise leave
    // the popup stuck in "picking" forever with no explanation.
    function onMouseOver(e: MouseEvent) {
      const target = realTargetOf(e);
      if (target && target.tagName === "IFRAME") {
        finish({ ok: false, reason: "iframe-unsupported" });
      }
    }

    function onClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();

      const target = realTargetOf(e);
      if (!target) {
        finish({ ok: false, reason: "No element found at the clicked point." });
        return;
      }

      // Belt-and-suspenders: if some future browser change ever does
      // deliver a click with the <iframe> itself as the target (e.g. a
      // click exactly on its border), still report it the same way
      // rather than generating a selector for the wrapper element.
      if (target.tagName === "IFRAME") {
        finish({ ok: false, reason: "iframe-unsupported" });
        return;
      }

      if (isInsideShadowDom(target)) {
        finish({ ok: false, reason: "shadow-dom-unsupported" });
        return;
      }

      const rect = target.getBoundingClientRect();
      const { selector, confidence } = generateSelectorInPage(target);
      finish({
        ok: true,
        selector,
        confidence,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        finish({ ok: false, reason: "cancelled" });
      }
    }

    document.addEventListener("mousemove", onMouseMove, true);
    document.addEventListener("mouseover", onMouseOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);
  });
}

/**
 * Triggers the hover-highlight/click-to-select picker on whichever tab is
 * currently active, via `chrome.scripting.executeScript` (the `activeTab`
 * gesture chain — see file header). Must be called synchronously enough
 * after a user gesture (e.g. directly from a popup button's onClick) for
 * `activeTab` to still be granted.
 */
export async function pickElementOnActiveTab(): Promise<PickResult> {
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
    return { ok: false, reason: "No active tab available to pick an element from." };
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: runPickerInPage,
    });
    const result = results[0]?.result as PickResult | undefined;
    if (!result) {
      return { ok: false, reason: "The picker did not return a result." };
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
          : "Could not start the element picker on this page.",
    };
  }
}
