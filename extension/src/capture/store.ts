// F283 — handoff point for the next M19 feature (annotation UI).
//
// Scope note: this feature only captures and holds the result; it does
// not build the annotation overlay or the upload. The captured PNG is
// deliberately NOT persisted to chrome.storage (data URLs can be several
// MB and the popup's job here ends the moment a later feature's UI reads
// this module), so a plain in-module singleton is enough — see the F283
// handoff "Decisions made" for the full reasoning. The popup component
// that captures also holds this in React state for rendering the
// immediate confirmation; this module exists so that a *different*
// component mounted later in the same popup document tree (e.g. an
// annotation screen the next feature renders in place of this one) can
// read the same captured image without re-deriving it or re-triggering a
// second `activeTab` capture.
import type { CaptureResult } from "./visible-tab";

export type CapturedScreenshot = Extract<CaptureResult, { ok: true }>;

let current: CapturedScreenshot | null = null;

export function setLastCapture(capture: CapturedScreenshot): void {
  current = capture;
}

export function getLastCapture(): CapturedScreenshot | null {
  return current;
}

export function clearLastCapture(): void {
  current = null;
}

// F285 — AS-545: once the user has drawn annotations and confirmed, the
// flattened-with-annotations PNG is what a later feature (attaching to a
// task) must read — never the pristine, unannotated capture above. This
// is a sibling slot rather than an overwrite of `current`/`setLastCapture`
// for two reasons: (1) `CapturedScreenshot` above is typed to exactly the
// `CaptureResult` shape `chrome.tabs.captureVisibleTab` produces
// (`devicePixelRatio`, `capturedAt`) — an annotated result has neither of
// those and is a real-pixel PNG derived from a canvas flatten, not a raw
// tab capture, so forcing it into the same type would be a lie; (2) F284's
// own handoff explicitly punted the "where does the cropped/derived image
// live" question here, flagging that only the raw capture survives in
// this module today. This slot is the answer for the annotated result:
// same in-module-singleton pattern as `current` (not `chrome.storage` —
// same size/lifetime reasoning as F283's original decision), so a later
// feature reads `getAnnotatedResult()` if present, falling back to
// `getLastCapture()` only when the user never annotated at all.
export type AnnotatedResult = {
  dataUrl: string;
  width: number;
  height: number;
};

let currentAnnotated: AnnotatedResult | null = null;

export function setAnnotatedResult(result: AnnotatedResult): void {
  currentAnnotated = result;
}

export function getAnnotatedResult(): AnnotatedResult | null {
  return currentAnnotated;
}

export function clearAnnotatedResult(): void {
  currentAnnotated = null;
}
