// F301 follow-up (region-selection-mid-flow-focus-loss fix).
//
// Root cause this module exists to work around: a Chrome MV3 action popup
// closes automatically the instant it loses focus
// (https://developer.chrome.com/docs/extensions/reference/api/action,
// "popup" — a popup is just a normal browser window that closes on blur
// like any other, verified 2026-08-21), and drawing a region selection on
// the live page necessarily requires clicking INTO that page, which
// steals focus from the popup. The old implementation ran the entire
// capture orchestration (inject overlay -> await selection -> capture tab
// -> crop) inside the popup's own JS realm, so the moment the user clicked
// the page to start dragging, that whole async function — and every
// Promise in its chain — was destroyed along with the popup, and nothing
// ever completed or was stored.
//
// The fix (see `background/service-worker.ts`'s `runRegionCapture`) moves
// that entire orchestration into the background service worker, which
// persists independently of whether any popup is open. This module is the
// handoff point for the RESULT of that background work, reusing exactly
// the same "persist to chrome.storage.local, restore on fresh popup
// mount" architecture `submit/draft.ts` already established for drafts
// (see that file's header for the original reasoning this borrows
// wholesale) — the popup can close and reopen at any point mid-flow, so
// the result has to live somewhere that survives the popup's own JS realm
// being torn down and rebuilt.
import type { CropResult } from "./crop";

export const PENDING_CAPTURE_RESULT_KEY = "pmapp-pending-capture-result";

export type PendingCaptureResult =
  | {
      ok: true;
      dataUrl: string;
      width: number;
      height: number;
      devicePixelRatio: number;
      capturedAt: number;
    }
  | {
      // Every failure state — cancelled, restricted page, capture error,
      // crop error — states what happened rather than silently vanishing.
      // "cancelled" (Escape) is a real, distinct reason from an actual
      // error: the popup restore logic treats it as "return to idle,
      // nothing to show", never as an error banner.
      ok: false;
      reason: string;
    };

function isPendingCaptureResult(value: unknown): value is PendingCaptureResult {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.ok === true) {
    return (
      typeof v.dataUrl === "string" &&
      typeof v.width === "number" &&
      typeof v.height === "number" &&
      typeof v.devicePixelRatio === "number" &&
      typeof v.capturedAt === "number"
    );
  }
  if (v.ok === false) {
    return typeof v.reason === "string";
  }
  return false;
}

/** Written by the background service worker, regardless of whether the
 * popup that started the capture is still open. See
 * `background/service-worker.ts`'s `runRegionCapture`. */
export async function writePendingCaptureResult(
  result: PendingCaptureResult,
): Promise<void> {
  await chrome.storage.local.set({ [PENDING_CAPTURE_RESULT_KEY]: result });
}

/**
 * Reads and immediately clears the pending capture result, if any — same
 * "read once, then clear" convention `draft.ts` uses for its own storage
 * key, so a later, unrelated popup mount (or a later, unrelated capture
 * attempt) never re-shows or re-processes a stale result. Never throws —
 * a missing or malformed value resolves `null` ("nothing pending"), same
 * convention as `draft.ts`'s `getDraft()`.
 */
export async function readAndClearPendingCaptureResult(): Promise<PendingCaptureResult | null> {
  try {
    const stored = await chrome.storage.local.get(PENDING_CAPTURE_RESULT_KEY);
    const value = stored[PENDING_CAPTURE_RESULT_KEY];
    await chrome.storage.local.remove(PENDING_CAPTURE_RESULT_KEY);
    if (isPendingCaptureResult(value)) return value;
    return null;
  } catch {
    return null;
  }
}

/** Converts a successful pending result into the `CropResult` shape the
 * existing capture-state UI (and the annotation editor downstream of it)
 * already expects — never changed, per this fix's own scope. */
export function pendingResultToCropResult(
  pending: Extract<PendingCaptureResult, { ok: true }>,
): CropResult {
  return { dataUrl: pending.dataUrl, width: pending.width, height: pending.height };
}
