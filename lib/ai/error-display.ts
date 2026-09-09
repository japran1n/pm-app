// F020: maps an assistant `error` event's `code` to display metadata for
// the sidebar. Every code renders as a human sentence — the server's
// `message` field is already human-readable (it's the wire contract), this
// module only decides styling and (for unrecognised codes) a safe fallback
// sentence so an unknown/future code never renders raw or blank.

export type ErrorTone = "neutral" | "warning";

export interface ErrorDisplay {
  message: string;
  tone: ErrorTone;
}

const KNOWN_CODES = new Set([
  "no_api_key",
  "rate_limit",
  "thread_limit",
  "auth_error",
  "model_error",
  // Existing codes this route already emits (handleUpstreamError /
  // tool-loop errors) — kept warning-toned like the other failure codes.
  "rate_limited",
  "upstream",
  "tool_limit",
]);

/**
 * `no_api_key` is a configuration state, not a failure (per spec) — it
 * renders neutrally, with none of the warning styling the rest of the
 * error codes get.
 */
const NEUTRAL_CODES = new Set(["no_api_key"]);

/**
 * Resolves the sentence + tone to render for an `error` event. Falls back
 * to a generic "Something went wrong" sentence for any code this module
 * doesn't recognise, so a future/unknown code never renders blank or raw.
 */
export function getErrorDisplay(event: { code: string; message: string }): ErrorDisplay {
  const tone: ErrorTone = NEUTRAL_CODES.has(event.code) ? "neutral" : "warning";

  if (KNOWN_CODES.has(event.code) && event.message.trim().length > 0) {
    return { message: event.message, tone };
  }

  return { message: "Something went wrong. Please try again.", tone: "warning" };
}
