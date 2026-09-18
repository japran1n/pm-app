"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";

// F257 (AS-500): shared render body for every route-segment `error.tsx`
// under app/(workspace)/w/[workspaceSlug]/**/ plus the root app/error.tsx.
// Next.js error boundaries only catch errors thrown by the segment they
// sit in and everything below it — the nearest parent layout (the
// workspace shell: sidebar/nav in
// app/(workspace)/w/[workspaceSlug]/layout.tsx) stays mounted and
// rendered around this boundary, which is exactly what AS-500 requires
// ("an error in one view does not blank the whole app shell"). This
// component is deliberately a thin, dumb, prop-only body — it holds no
// state and does no fetching of its own — so every one of the many
// `error.tsx` call sites can stay a 10-line wrapper instead of
// duplicating this markup, per the clarified "reuse a shared error-
// display primitive if it reduces duplication" instruction.
//
// Never renders `error.message` or a stack trace to the user (per the
// clarified failure-handling answer and the spec's explicit "never a raw
// stack trace" requirement) — only a fixed, plain-language sentence.
// The real error is still logged to the console (dev-visible, no
// external reporting service per this feature's explicit out-of-scope
// note: no Sentry/etc.) so a developer can find it without exposing it
// to the end user.
export function RouteError({
  error,
  reset,
  title = "Something went wrong",
  description = "This view ran into a problem loading. You can try again, or head back and try a different view.",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title?: string;
  description?: string;
}) {
  useEffect(() => {
    // Intentional dev-visible log, never shown to the user (see file
    // header for why: no external error-reporting service is in scope).
    console.error(error);

    // Client-side errors otherwise produce no server-side signal at all —
    // POST this one to the logger so it shows up alongside server-side
    // errors. Best-effort only: reporting failures must never break the
    // error page itself.
    fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error.message,
        digest: error.digest,
        url: typeof window !== "undefined" ? window.location.href : undefined,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16 text-center"
    >
      <div
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-destructive/10"
      >
        <AlertTriangle className="size-6 text-destructive" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-xl font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
        {error.digest && (
          <p className="font-mono text-muted-foreground text-xs mt-2">
            Error ID: {error.digest}
          </p>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        // AS-500: retry must actually re-run the failed render, not just
        // re-paint the same failed state. Next's `reset()` does exactly
        // this — it re-mounts the segment boundary, which re-invokes the
        // Server Component (and therefore re-runs the data fetch that
        // threw) rather than re-rendering the same thrown-error subtree.
        onClick={() => reset()}
      >
        <RotateCw className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
