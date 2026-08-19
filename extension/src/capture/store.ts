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
