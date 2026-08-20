// F291 — AS-554: console and network capture can be turned off per report.
//
// ---------------------------------------------------------------------
// Orchestrator-resolved scope note (do not re-litigate — see this
// feature's handoff "Decisions made" for the full reasoning): the
// feature spec's draft scope says "Toggles in the report form", but no
// unified report form exists yet (F293, still unbuilt, is what will
// eventually assemble screenshot + annotations + picked element +
// environment metadata + console log + network log into one submitted
// report). Following the exact precedent F289/F290 already set — their
// own independent, standalone popup UI sections rather than waiting on
// a form that didn't exist — this feature builds its own standalone
// toggle/preference logic and UI now, wired to gate F289's and F290's
// existing "Start capturing" flows. A future F293 should read/reuse
// this module's `getCapturePreferences`/`setCapturePreferences` and the
// two gating functions below rather than reimplementing capture on/off
// logic.
// ---------------------------------------------------------------------
//
// Core correctness requirement: with a toggle off, nothing is ever
// collected — not collected-then-discarded. F289/F290's existing
// `chrome.scripting.executeScript` calls only ever run from an explicit
// popup button click; this module's job is to make that click's effect
// conditional on a PERSISTENT, PER-USER preference (`chrome.storage.local`,
// same storage this extension already uses for the auth session per
// F281/F282's `chromeStorageAdapter`), so the preference genuinely gates
// the `executeScript` call itself — the underlying hook is never
// installed on the page when its toggle is off, not merely hidden from
// the popup UI once captured.

export type CapturePreferences = {
  consoleCaptureEnabled: boolean;
  networkCaptureEnabled: boolean;
};

// Per the clarification's tie-breaker ("the simpler, more private
// option — less data captured, narrower permission — by default"), both
// toggles default to OFF until the reporter explicitly turns them on.
export const DEFAULT_CAPTURE_PREFERENCES: CapturePreferences = {
  consoleCaptureEnabled: false,
  networkCaptureEnabled: false,
};

// Follows the same flat, unprefixed key-naming convention as the rest of
// this extension's `chrome.storage.local` usage (see
// lib/chrome-storage-adapter.ts's header comment: "chrome.storage.local
// is namespaced per-extension already, so no key prefixing is needed").
export const CAPTURE_PREFERENCES_STORAGE_KEY = "pmapp-capture-preferences";

function isCapturePreferences(value: unknown): value is CapturePreferences {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<CapturePreferences>).consoleCaptureEnabled === "boolean" &&
    typeof (value as Partial<CapturePreferences>).networkCaptureEnabled === "boolean"
  );
}

/**
 * Reads the reporter's persisted capture preferences from
 * `chrome.storage.local`. Never throws — an unset, malformed, or
 * partially-written value falls back to the private-by-default
 * `DEFAULT_CAPTURE_PREFERENCES` rather than surfacing a hard error (a
 * corrupted preference should never silently turn capture ON).
 */
export async function getCapturePreferences(): Promise<CapturePreferences> {
  try {
    const result = await chrome.storage.local.get(CAPTURE_PREFERENCES_STORAGE_KEY);
    const stored = result[CAPTURE_PREFERENCES_STORAGE_KEY];
    if (isCapturePreferences(stored)) {
      return stored;
    }
    return { ...DEFAULT_CAPTURE_PREFERENCES };
  } catch {
    return { ...DEFAULT_CAPTURE_PREFERENCES };
  }
}

/**
 * Persists a (partial) update to the reporter's capture preferences,
 * merged onto whatever is currently stored (or the defaults), and
 * returns the merged result so callers can update UI state from the
 * same round-trip. Always visible/reversible: flipping a toggle takes
 * effect immediately and does not require a reload or clear any
 * already-captured data — this only ever writes the preference, never
 * touches a running capture's buffer.
 */
export async function setCapturePreferences(
  patch: Partial<CapturePreferences>,
): Promise<CapturePreferences> {
  const current = await getCapturePreferences();
  const merged: CapturePreferences = { ...current, ...patch };
  await chrome.storage.local.set({ [CAPTURE_PREFERENCES_STORAGE_KEY]: merged });
  return merged;
}

export type GatedStartResult = { ok: true } | { ok: false; reason: string };

/**
 * Gates F289's `startConsoleCaptureOnActiveTab` behind the persisted
 * `consoleCaptureEnabled` preference. When the toggle is off, this
 * NEVER calls `chrome.scripting.executeScript` — the console hook is
 * never installed on the page, so nothing can ever be recorded, not
 * merely hidden from the popup. Callers must be supplied the real
 * starter function (dependency-injected) so this module has no import
 * cycle with console-hook.ts and so tests can substitute a spy without
 * needing a real active tab.
 */
export async function startConsoleCaptureIfEnabled(
  starter: () => Promise<GatedStartResult>,
): Promise<GatedStartResult> {
  const prefs = await getCapturePreferences();
  if (!prefs.consoleCaptureEnabled) {
    return {
      ok: false,
      reason:
        "Console capture is turned off. Turn on \"Capture console errors/warnings\" above to start capturing.",
    };
  }
  return starter();
}

/**
 * Gates F290's `startNetworkCaptureOnActiveTab` behind the persisted
 * `networkCaptureEnabled` preference. Same "never installs the hook
 * when off" contract as `startConsoleCaptureIfEnabled` above.
 */
export async function startNetworkCaptureIfEnabled(
  starter: () => Promise<GatedStartResult>,
): Promise<GatedStartResult> {
  const prefs = await getCapturePreferences();
  if (!prefs.networkCaptureEnabled) {
    return {
      ok: false,
      reason:
        "Network capture is turned off. Turn on \"Capture failed network requests\" above to start capturing.",
    };
  }
  return starter();
}
