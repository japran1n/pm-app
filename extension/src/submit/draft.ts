// F297 (AS-565): persists the reporter's in-progress report — every form
// field plus the annotated/captured screenshot, if any — to
// `chrome.storage.local` at the moment a submit is ATTEMPTED (not on every
// keystroke, and not only after a failure). This is the pragmatic middle
// ground the feature spec itself calls out: writing on every keystroke is
// wasteful, writing only after a failure risks losing everything typed if
// the extension/browser dies mid-network-call rather than mid-typing, and
// AS-565's own wording ("an offline SUBMISSION") is about the moment of
// submitting, not the moment of typing. See report-form.tsx's handleSubmit
// for the exact call site (right after resolving whatever screenshot state
// exists, before the size check or the fetch).
//
// Cleared only after a real, successful task creation (see
// report-form.tsx) — never on a failure, so the reporter can reopen the
// popup and retry from exactly where they left off without redoing the
// capture/annotation.
//
// Storage quota (this feature's own flagged open question, resolved here):
// verified against the current Chrome extension docs
// (https://developer.chrome.com/docs/extensions/reference/api/storage,
// fetched 2026-08-20) that `chrome.storage.local`'s real, current
// `QUOTA_BYTES` — the property `StorageArea.local.QUOTA_BYTES` documents,
// measured "as the JSON stringification of every value plus every key's
// length" — is 10,485,760 bytes (10MB), and that this limit is IGNORED only
// if the extension has the `unlimitedStorage` permission. This extension
// does not (and, per tech-decisions.md's narrow-permission stance, should
// not without a strong justification this feature does not have — not
// added here). `extension/src/submit/upload.ts`'s own
// `MAX_ATTACHMENT_SIZE_BYTES` (10MB, mirroring
// `lib/validation/attachments.ts`) is the max DECODED size of a screenshot
// PNG — but a base64 data URL is ~4/3 the decoded size, so a
// maximum-sized, allowed-to-upload screenshot's data URL alone
// (~13.3MB of base64 text) would already exceed the ENTIRE 10MB quota by
// itself, with zero room left for the rest of the draft (form fields,
// this key's own name, JSON overhead) or anything else this extension ever
// writes to `chrome.storage.local` (session tokens, F291's privacy
// toggles, F296's remembered workspace/project).
//
// Per the clarification's "less data, simpler, more private" tie-breaker,
// this module degrades gracefully instead of either (a) always trying to
// persist the image and risking a silent write failure, or (b) never
// persisting the image at all: the form's TEXT fields are ALWAYS persisted
// (they're tiny — a few KB at most), and the image is persisted alongside
// them only when its data URL is under `DRAFT_IMAGE_MAX_DATA_URL_LENGTH`
// (6MB of base64 text, chosen to leave several MB of headroom under the
// real 10MB quota for the text fields, this key's own JSON overhead, and
// everything else already living in `chrome.storage.local`). When the
// image doesn't fit, the draft is still written (text fields only) and the
// caller is told plainly, via `imageOmitted: true`, that the screenshot
// itself could not be preserved for retry — never a silent drop.
export const DRAFT_STORAGE_KEY = "pmapp-report-draft";

// ~6MB of base64 text. Corresponds to roughly 4.5MB of real decoded PNG
// bytes (base64 inflates by ~4/3) — well under the 10MB
// MAX_ATTACHMENT_SIZE_BYTES upload cap, but chosen deliberately smaller
// than "as much as technically fits" so the draft write has real headroom
// under the 10MB total quota rather than sitting right at the edge of it.
export const DRAFT_IMAGE_MAX_DATA_URL_LENGTH = 6 * 1024 * 1024;

export type ReportDraftFields = {
  workspaceId: string;
  projectId: string;
  status: string;
  title: string;
  description: string;
  assigneeId: string;
  priority: string;
  dueDate: string;
};

export type ReportDraft = ReportDraftFields & {
  /** The annotated/captured screenshot's data URL, if it fit under the quota-safe cap. `null` if there was no screenshot, or it didn't fit (see `imageOmitted`). */
  imageDataUrl: string | null;
  /** True when a screenshot existed at save time but was too large to persist alongside the quota-safe cap — the reporter's typed fields are still saved, but the image itself will need to be recaptured on retry. */
  imageOmitted: boolean;
};

function isReportDraft(value: unknown): value is ReportDraft {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Partial<ReportDraft>;
  return (
    typeof v.workspaceId === "string" &&
    typeof v.projectId === "string" &&
    typeof v.status === "string" &&
    typeof v.title === "string" &&
    typeof v.description === "string" &&
    typeof v.assigneeId === "string" &&
    typeof v.priority === "string" &&
    typeof v.dueDate === "string" &&
    (v.imageDataUrl === null || typeof v.imageDataUrl === "string") &&
    typeof v.imageOmitted === "boolean"
  );
}

/**
 * Reads the persisted unsent draft, if any. Never throws — a missing,
 * malformed, or partially-written value returns `null` ("no draft") rather
 * than surfacing a hard error, same convention as `state/preferences.ts`'s
 * `getLastReportContext`.
 */
export async function getDraft(): Promise<ReportDraft | null> {
  try {
    const result = await chrome.storage.local.get(DRAFT_STORAGE_KEY);
    const stored = result[DRAFT_STORAGE_KEY];
    if (isReportDraft(stored)) return stored;
    return null;
  } catch {
    return null;
  }
}

export type SaveDraftResult = {
  /** False when a screenshot existed but did not fit under the quota-safe cap — the caller should tell the reporter their image wasn't preserved. */
  imageSaved: boolean;
};

/**
 * Persists the current form state, called at the moment a submit is
 * attempted (see this module's doc comment for why that timing, not every
 * keystroke and not only on failure). Never throws — if the write itself
 * fails (e.g. a real quota overrun despite the cap above, from other data
 * already occupying the quota), this resolves with `imageSaved: false`
 * rather than throwing, since a draft-persistence failure must never block
 * the actual submit attempt that's about to happen.
 */
export async function saveDraft(
  fields: ReportDraftFields,
  screenshot: { dataUrl: string } | null,
): Promise<SaveDraftResult> {
  const fitsUnderCap = Boolean(screenshot) && screenshot!.dataUrl.length <= DRAFT_IMAGE_MAX_DATA_URL_LENGTH;
  const draft: ReportDraft = {
    ...fields,
    imageDataUrl: fitsUnderCap ? screenshot!.dataUrl : null,
    imageOmitted: Boolean(screenshot) && !fitsUnderCap,
  };

  try {
    await chrome.storage.local.set({ [DRAFT_STORAGE_KEY]: draft });
    return { imageSaved: fitsUnderCap };
  } catch {
    // Real-world belt-and-suspenders: even the quota-safe cap above could
    // theoretically still overflow if other data already occupies most of
    // the 10MB quota. Retry once with the image dropped entirely, so the
    // reporter's typed fields are still saved even in that edge case.
    try {
      await chrome.storage.local.set({
        [DRAFT_STORAGE_KEY]: { ...fields, imageDataUrl: null, imageOmitted: Boolean(screenshot) },
      });
    } catch {
      // Genuinely out of room even for text-only fields — nothing more this
      // module can do; the in-memory form state itself is untouched, so the
      // reporter loses nothing as long as this popup mount stays open.
    }
    return { imageSaved: false };
  }
}

/** Clears the persisted draft. Called only after a real, successful task creation. */
export async function clearDraft(): Promise<void> {
  await chrome.storage.local.remove(DRAFT_STORAGE_KEY);
}
