// F296 (AS-564): the last-used workspace/project the reporter picked in the
// report form, persisted to `chrome.storage.local` so it's preselected the
// next time the popup opens. Follows F291's `privacy-toggles.ts` exact
// conventions: a flat, unprefixed key, merge-patch writes, and a malformed
// or unset stored value falls back to "no remembered context" rather than
// throwing — a corrupted preference should never crash the popup or force
// a bad selection.
//
// Deliberately narrow (per AS-564's literal wording, "the last used
// workspace and project"): only workspaceId/projectId are remembered here.
// status/title/description/assignee/priority/due-date are NOT persisted —
// a "report another" pass or a fresh popup mount always starts those back
// at their original defaults (see report-form.tsx).
export type LastReportContext = {
  workspaceId: string;
  projectId: string;
};

export const LAST_REPORT_CONTEXT_STORAGE_KEY = "pmapp-last-report-context";

function isLastReportContext(value: unknown): value is LastReportContext {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<LastReportContext>).workspaceId === "string" &&
    typeof (value as Partial<LastReportContext>).projectId === "string" &&
    (value as Partial<LastReportContext>).workspaceId !== "" &&
    (value as Partial<LastReportContext>).projectId !== ""
  );
}

/**
 * Reads the reporter's remembered last-used workspace/project from
 * `chrome.storage.local`. Never throws — an unset, malformed, or
 * partially-written value returns `null` ("no remembered context") rather
 * than surfacing a hard error.
 */
export async function getLastReportContext(): Promise<LastReportContext | null> {
  try {
    const result = await chrome.storage.local.get(LAST_REPORT_CONTEXT_STORAGE_KEY);
    const stored = result[LAST_REPORT_CONTEXT_STORAGE_KEY];
    if (isLastReportContext(stored)) {
      return stored;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists the workspace/project used for a just-SUCCEEDED report. Callers
 * must only call this after a real successful submit (not on every
 * keystroke/selection change), so an abandoned or never-submitted form
 * never pollutes the remembered context with a workspace the reporter was
 * just browsing, not actually reporting into. This is a full overwrite
 * (not a merge-patch of a larger preferences object, since this key holds
 * only these two fields) but follows the same "read-then-write via
 * chrome.storage.local.set" shape as privacy-toggles.ts's
 * setCapturePreferences.
 */
export async function setLastReportContext(
  context: LastReportContext,
): Promise<void> {
  await chrome.storage.local.set({ [LAST_REPORT_CONTEXT_STORAGE_KEY]: context });
}
