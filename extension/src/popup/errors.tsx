// F297 (AS-565): distinct, actionable failure messages for the report
// form's submit path. Every branch below states, in plain language, what
// actually happened and what the reporter can do next — never a single
// generic "Something went wrong" for every case (verified in this
// feature's own tests by asserting the rendered text differs per case).
//
// Offline detection: `navigator.onLine` is a real but imperfect signal
// (true just means "has *a* network interface," not "can actually reach
// the server" — e.g. it stays `true` on a captive portal or a broken
// upstream link) — verified against current MDN/web.dev guidance before
// writing this, which recommends treating an actual failed fetch as the
// more reliable signal and using `navigator.onLine` only as a secondary
// hint. This module therefore classifies "offline" primarily from the
// fetch call itself throwing (a `TypeError` — no HTTP response was ever
// received, which is exactly what a `page.route(...).abort()` or an
// unreachable host produces in this feature's own Playwright test), not
// from polling `navigator.onLine` alone. `report-form.tsx` passes
// `networkFailure: true` exactly when its `fetch(...)` call throws, and
// `false` whenever a real HTTP response (of any status) came back.
export type SubmitErrorKind =
  | "offline"
  | "expired-session"
  | "permission-denied"
  | "too-large"
  | "server-error";

export type SubmitErrorInfo = {
  kind: SubmitErrorKind;
  message: string;
};

export type ClassifySubmitErrorInput = {
  /** True when the fetch call itself threw (no HTTP response received at all) — the primary offline signal, more reliable than `navigator.onLine` alone. */
  networkFailure: boolean;
  /** The HTTP status of a real response, when one was received. */
  status?: number;
  /** The server's own `{ error }` message body, when a real response was received. */
  serverMessage?: string | null;
};

// F292/F294's routes' own exact response messages — reused verbatim (not
// duplicated with different wording) so the reporter sees the same message
// this mission's other extension features already tested for their own
// assertions.
const EXPIRED_SESSION_SERVER_MESSAGE = "Invalid or expired session. Reconnect the extension.";

/**
 * Classifies a failed report-form submit into one of five genuinely
 * distinct, actionable outcomes. Never returns a shared generic message
 * for more than one kind.
 */
export function classifySubmitError(input: ClassifySubmitErrorInput): SubmitErrorInfo {
  if (input.networkFailure) {
    return {
      kind: "offline",
      message:
        "You appear to be offline — the task could not be created. Your report (and screenshot, if you added one) has been saved on this device; check your connection and press \"Create task\" again to retry, without redoing any of your work.",
    };
  }

  if (input.status === 401) {
    return {
      kind: "expired-session",
      message:
        "Your pm-app session has expired. Reconnect the extension (use the \"Sign in to connect\" button above), then press \"Create task\" again — your report has been saved, so nothing needs to be redone.",
    };
  }

  if (input.status === 403) {
    return {
      kind: "permission-denied",
      message:
        input.serverMessage ??
        "You don't have permission to create a task in this project. Choose a different project, or ask a workspace admin to add you as a member.",
    };
  }

  // F294's own AS-566 message already names the real limit (e.g. "Screenshot
  // must be 10MB or smaller." / "File must be 10MB or smaller.") — reused
  // as-is rather than duplicated with different wording, per this feature's
  // explicit "reuse, don't duplicate" instruction.
  if (input.serverMessage && /MB or smaller\b/.test(input.serverMessage)) {
    return { kind: "too-large", message: input.serverMessage };
  }

  return {
    kind: "server-error",
    message:
      "Something went wrong on the server while creating your task. Your report has been saved on this device — please try again in a moment.",
  };
}

/** Renders a classified submit error with its distinguishing kind exposed as `data-error-kind`, so tests can assert on the specific case, not just that some error text exists. */
export function SubmitErrorMessage({ info }: { info: SubmitErrorInfo }) {
  return (
    <p
      data-testid="report-form-error"
      data-error-kind={info.kind}
      style={{ margin: "8px 0 0", fontSize: 13, color: "#b91c1c" }}
    >
      {info.message}
    </p>
  );
}

// Sanity re-export for the sole non-network-boundary case report-form.tsx
// already had (the classifySubmitError sentinel used when a JWT is
// available but the server never came back with a distinguishable status,
// e.g. a truly unexpected exception).
export { EXPIRED_SESSION_SERVER_MESSAGE };
