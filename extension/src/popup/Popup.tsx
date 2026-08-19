// F280 (AS-531): popup shell only — no capture, no auth. Later features
// (session handoff + chrome.storage.local adapter, per tech-decisions.md
// "QA feedback extension") replace the "not connected" state with real
// auth status.
export function Popup() {
  return (
    <main data-testid="popup-root" style={{ padding: 16 }}>
      <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>PM-App QA Feedback</h1>
      <p data-testid="connection-status" style={{ margin: 0, color: "#666" }}>
        Not connected
      </p>
    </main>
  );
}
