"use client";

import { useEffect, useRef, useState } from "react";

// Generic debounced-autosave hook -- F057 (missions/20260910-182104,
// AS-116, AS-118). AS-116 ("an answer is saved without the client
// pressing a save control") is the reason this fires from a `value`
// change effect rather than from any onClick; AS-118 ("a saved answer
// survives a page reload") is satisfied on the server side by
// `saveBriefAnswer` actually persisting the row -- this hook's only job
// is to call `saveFn` reliably, debounced, without dropping the last
// edit a user makes before navigating away.
//
// Deliberately generic (not brief-specific) so any future autosaved
// field in this codebase can reuse it without duplicating debounce logic.
// F020: a resolved `{ success: false }` (server actions resolve failures
// rather than throwing) and a rejection are both failures. Writes are chained
// so two saves to the same row can never race, and `flush` cancels the pending
// debounce timer so the same value is never written twice.
function failureOf(result: unknown): Error | null {
  if (
    result &&
    typeof result === "object" &&
    "success" in result &&
    (result as { success?: unknown }).success === false
  ) {
    const msg = (result as { error?: unknown }).error;
    return new Error(typeof msg === "string" ? msg : "Couldn't save");
  }
  return null;
}

export function useAutosave<T>(
  value: T,
  saveFn: (value: T) => Promise<unknown>,
  delay = 800,
) {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<Error | null>(null);

  // Tracks the value most recently *saved* (or the initial value), so a
  // save isn't fired again for a value that hasn't actually changed.
  const lastSavedValueRef = useRef<T>(value);
  const saveFnRef = useRef(saveFn);

  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  // Value whose debounce timer is still pending, plus the timer itself.
  const pendingRef = useRef<{ value: T } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tail of the write queue and count of queued/in-flight writes.
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  const inFlightRef = useRef(0);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // Resolves to true on success, false on failure. Never rejects.
  const runSave = (valueToSave: T): Promise<boolean> => {
    clearTimer();
    pendingRef.current = null;
    inFlightRef.current += 1;
    setSaving(true);
    const task = chainRef.current.then(async () => {
      try {
        const result = await saveFnRef.current(valueToSave);
        const failure = failureOf(result);
        if (failure) {
          setError(failure);
          // Keep the value pending so a later flush retries it (unless a
          // newer edit is already waiting).
          if (!pendingRef.current) pendingRef.current = { value: valueToSave };
          return false;
        }
        lastSavedValueRef.current = valueToSave;
        setError(null);
        setLastSaved(new Date());
        return true;
      } catch (e) {
        setError(e instanceof Error ? e : new Error("Couldn't save"));
        if (!pendingRef.current) pendingRef.current = { value: valueToSave };
        return false;
      } finally {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) setSaving(false);
      }
    });
    chainRef.current = task;
    return task;
  };
  const runSaveRef = useRef(runSave);
  useEffect(() => {
    runSaveRef.current = runSave;
  });

  useEffect(() => {
    if (value === lastSavedValueRef.current) {
      return;
    }

    pendingRef.current = { value };
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void runSaveRef.current(value);
    }, delay);

    return clearTimer;
  }, [value, delay]);

  // Writes any pending edit now (cancelling its timer) and resolves once the
  // write queue is drained. Resolves to false if the last write failed.
  const flush = async (): Promise<boolean> => {
    const pending = pendingRef.current;
    if (pending) return runSaveRef.current(pending.value);
    await chainRef.current;
    return true;
  };
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  // Unmount (e.g. the wizard moved to another section): don't lose the edit.
  useEffect(() => {
    return () => {
      void flushRef.current();
    };
  }, []);

  return { saving, lastSaved, error, flush };
}
