// F088 (TH-125) — resets editor working state when the fetched hostname
// changes.
//
// Fetching a different host must discard the currently open files and
// start fresh from the new document's blocks (TH-125). Version history is
// per-host persisted state (F089/storage.ts) and is intentionally left
// alone here — only the in-memory working set (open blocks, dirty state)
// resets.
import { useEffect, useRef } from "react";
import { clearEditorState } from "@/lib/webflow-editor/storage";

/**
 * Fires `onReset` whenever `hostname` changes from a previously-seen,
 * non-empty value. Does not fire on initial mount (there is no "previous
 * host" to have changed from), and does not fire on empty/undefined
 * hostnames (no site loaded yet).
 */
export function useHostReset(hostname: string, onReset: () => void): void {
  const previousHost = useRef<string | null>(null);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;

  useEffect(() => {
    const prev = previousHost.current;

    if (!hostname) {
      previousHost.current = hostname || null;
      return;
    }

    if (prev !== null && prev !== hostname) {
      clearEditorState(prev);
      onResetRef.current();
    }

    previousHost.current = hostname;
  }, [hostname]);
}
