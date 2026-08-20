import { useEffect, useState } from "react";

import {
  DEFAULT_CAPTURE_PREFERENCES,
  getCapturePreferences,
  setCapturePreferences,
  type CapturePreferences,
} from "../capture/privacy-toggles";

// F291 — AS-554: always-visible, reversible toggles for console/network
// capture, showing exactly what each one includes and (once a capture
// that's actually enabled has run) a live count of what it captured.
// Persisted per-user via chrome.storage.local (see
// capture/privacy-toggles.ts). No unified report form exists yet
// (F293) — see that module's header for the orchestrator-resolved scope
// note this component follows.
//
// Log preview is deliberately deferred (see this feature's handoff
// "Out-of-scope work needed"): the live counts below are themselves a
// form of summary, and the clarification's tie-breaker for open
// questions is "the simpler, more private option" — a full log-content
// preview modal is new UI surface AS-554's literal wording does not
// require.

export type PrivacyTogglesProps = {
  consoleCount?: number;
  networkCount?: number;
  onChange?: (prefs: CapturePreferences) => void;
};

export function CapturePrivacyToggles({ consoleCount, networkCount, onChange }: PrivacyTogglesProps) {
  const [prefs, setPrefs] = useState<CapturePreferences>(DEFAULT_CAPTURE_PREFERENCES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getCapturePreferences().then((loadedPrefs) => {
      if (cancelled) return;
      setPrefs(loadedPrefs);
      setLoaded(true);
      onChange?.(loadedPrefs);
    });
    return () => {
      cancelled = true;
    };
    // Intentionally only on mount — every popup open re-derives the
    // preference from chrome.storage.local rather than assuming any
    // in-memory default, matching this extension's established
    // "re-derivable from storage" pattern (see Popup.tsx's session
    // status header comment).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleConsole() {
    const next = await setCapturePreferences({ consoleCaptureEnabled: !prefs.consoleCaptureEnabled });
    setPrefs(next);
    onChange?.(next);
  }

  async function toggleNetwork() {
    const next = await setCapturePreferences({ networkCaptureEnabled: !prefs.networkCaptureEnabled });
    setPrefs(next);
    onChange?.(next);
  }

  return (
    <div
      data-testid="privacy-toggles"
      style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #e5e5e5" }}
    >
      <p style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 600 }}>What's captured</p>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8, fontSize: 13 }}>
        <input
          data-testid="privacy-toggle-console"
          type="checkbox"
          checked={prefs.consoleCaptureEnabled}
          disabled={!loaded}
          onChange={toggleConsole}
        />
        <span>
          Capture console errors/warnings — records console.error/console.warn calls, uncaught
          errors, and unhandled promise rejections made after you start capturing.
          {typeof consoleCount === "number" && (
            <span data-testid="privacy-toggle-console-count"> ({consoleCount} console error{consoleCount === 1 ? "" : "s"} captured)</span>
          )}
        </span>
      </label>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13 }}>
        <input
          data-testid="privacy-toggle-network"
          type="checkbox"
          checked={prefs.networkCaptureEnabled}
          disabled={!loaded}
          onChange={toggleNetwork}
        />
        <span>
          Capture failed network requests — records the method, URL (secrets redacted), and status
          of failed requests made after you start capturing. Request/response bodies and
          successful requests are never captured.
          {typeof networkCount === "number" && (
            <span data-testid="privacy-toggle-network-count"> ({networkCount} failed request{networkCount === 1 ? "" : "s"} captured)</span>
          )}
        </span>
      </label>

      <p style={{ margin: "8px 0 0", fontSize: 12, color: "#666" }}>
        With a toggle off, nothing is collected for it — turning it off does not just hide already
        captured results. You can turn either on or off at any time before sending a report.
      </p>
    </div>
  );
}
