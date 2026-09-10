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
export function useAutosave<T>(
  value: T,
  saveFn: (value: T) => Promise<unknown>,
  delay = 800,
) {
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  // Tracks the value most recently *saved* (or the initial value), so a
  // save isn't fired again for a value that hasn't actually changed --
  // e.g. on first mount, or after saveFn resolves and this effect re-runs
  // because `saveFn`/`delay` identity happens to change.
  const lastSavedValueRef = useRef<T>(value);
  const saveFnRef = useRef(saveFn);

  useEffect(() => {
    saveFnRef.current = saveFn;
  }, [saveFn]);

  useEffect(() => {
    if (value === lastSavedValueRef.current) {
      return;
    }

    const timer = setTimeout(() => {
      const valueToSave = value;
      setSaving(true);
      Promise.resolve(saveFnRef.current(valueToSave))
        .then(() => {
          lastSavedValueRef.current = valueToSave;
          setLastSaved(new Date());
        })
        .finally(() => {
          setSaving(false);
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return { saving, lastSaved };
}
