"use client";

// F007: shared helper extracted from F001-F006's identical
// `useOptimistic` + `useTransition` + `toast.error` triplet
// (list-priority-select.tsx, list-due-date-cell.tsx, and friends). Each
// of those components applied a new value optimistically inside a
// transition, called a Server Action, and showed a toast only on
// failure — relying on `useOptimistic`'s own auto-revert-once-the-
// transition-settles behaviour to restore the prior value, exactly as
// documented in list-priority-select.tsx's own F001 comment. This hook
// is that pattern, generalised over the field's value type `T`, with no
// behaviour change versus the hand-rolled versions it replaces.
//
// Per this feature's clarified API contract: the hook owns no shared
// state (each caller gets its own instance), does no validation (the
// caller validates before calling `run`), and handles the failure toast
// internally so callers don't need their own try/catch — `errorMessage`
// is the fallback shown when the action doesn't return a more specific
// `{ error }` string of its own.
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

export function useOptimisticAction<T>(
  current: T,
  action: (value: T) => Promise<void | { error: string }>,
  errorMessage: string,
): [T, boolean, (newValue: T) => void] {
  const [isPending, startTransition] = useTransition();
  const [optimisticValue, setOptimisticValue] = useOptimistic<T>(current);

  function run(newValue: T) {
    startTransition(async () => {
      // Applied synchronously, inside the transition, before the
      // `await` below — the caller renders the new value immediately,
      // without waiting for `action`'s server round trip.
      setOptimisticValue(newValue);
      try {
        const result = await action(newValue);
        if (result && "error" in result) {
          // No manual revert needed: `useOptimistic` falls back to the
          // base `current` value once this transition settles without
          // `current` itself having changed — this toast is the only
          // manual work a failure needs.
          toast.error(result.error || errorMessage);
        }
      } catch {
        // A thrown rejection (network loss, 500, serialization error)
        // gets the same treatment as an `{ error }` return: no manual
        // revert needed, `useOptimistic` still falls back to `current`
        // once this transition settles.
        toast.error(errorMessage);
      }
    });
  }

  return [optimisticValue, isPending, run];
}
