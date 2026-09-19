// F088 (TH-125) — resets editor working state when the fetched hostname
// changes.
//
// Fetching a different host must discard the currently open files and
// start fresh from the new document's blocks (TH-125). This only resets
// the in-memory working set (open blocks, dirty state) for the new host --
// it must NOT clear the previous host's persisted localStorage entry
// (TH-254/TH-255). Per-host state should survive until the user explicitly
// clears it or the storage quota is exceeded, so navigating back to a
// previously visited host still restores what was there.
import { useEffect, useRef } from "react";

/**
 * Fires `onReset` whenever `hostname` changes from a previously-seen,
 * non-empty value. Does not fire on initial mount (there is no "previous
 * host" to have changed from), and does not fire on empty/undefined
 * hostnames (no site loaded yet).
 */
export function useHostReset(hostname: string, onReset: () => void): void {
  const previousHost = useRef<string | null>(null);
  const onResetRef = useRef(onReset);
  useEffect(() => {
    onResetRef.current = onReset;
  }, [onReset]);

  useEffect(() => {
    const prev = previousHost.current;

    if (!hostname) {
      previousHost.current = hostname || null;
      return;
    }

    if (prev !== null && prev !== hostname) {
      onResetRef.current();
    }

    previousHost.current = hostname;
  }, [hostname]);
}
