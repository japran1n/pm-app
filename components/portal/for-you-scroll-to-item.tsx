"use client";

// Mission 20260914-portal-simplify, F013 (AS-017): when a link into "For
// you" names one specific decision (`?approvalId=...` -- from the
// approvals-queue "Copy link" action, or a stale link into the old
// `p/approvals?approvalId=` route redirected here), scroll that row into
// view and give it a brief highlight so the client doesn't have to hunt
// for it in the list. Deliberately the cheapest possible version of this:
// no animation library, no intersection observer -- one `useEffect`,
// `scrollIntoView`, and a CSS class removed after a short timeout.
//
// Portal polish follow-up (AS-011): a stale `?approvalId=` link (the
// decision was already approved/rejected, or is filtered out of the
// current view) previously scrolled to nothing and gave the client no
// feedback at all -- indistinguishable from a slow page load. When the
// target row isn't in the DOM, render an inline banner instead of
// silently doing nothing, pointing the client at the history disclosure
// below where the decided item now lives.
import { useEffect, useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";

export function ForYouScrollToItem({ targetId }: { targetId: string }) {
  // `mounted` is `false` on both the server render and the client's first
  // (hydration) render -- only flipping `true` on the next client render --
  // so `document.getElementById` below is never reached before hydration,
  // avoiding a server/client mismatch without a `useEffect` + `setState`
  // pair (this repo's `react-hooks/set-state-in-effect` rule), matching the
  // established pattern in components/onboarding/tour.tsx.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const notFound = mounted && document.getElementById(targetId) === null;

  useEffect(() => {
    const el = document.getElementById(targetId);
    if (!el) return;

    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-foreground", "rounded-lg");
    const timer = setTimeout(() => {
      el.classList.remove("ring-2", "ring-foreground", "rounded-lg");
    }, 2000);

    return () => clearTimeout(timer);
  }, [targetId]);

  if (!notFound) return null;

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground"
      data-testid="for-you-scroll-to-item-not-found"
    >
      <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
      <span>That decision has already been handled — see it in the history below.</span>
    </div>
  );
}
