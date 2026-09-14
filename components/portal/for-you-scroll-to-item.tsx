"use client";

// Mission 20260914-portal-simplify, F013 (AS-017): when a link into "For
// you" names one specific decision (`?approvalId=...` -- from the
// approvals-queue "Copy link" action, or a stale link into the old
// `p/approvals?approvalId=` route redirected here), scroll that row into
// view and give it a brief highlight so the client doesn't have to hunt
// for it in the list. Deliberately the cheapest possible version of this:
// no animation library, no intersection observer -- one `useEffect`,
// `scrollIntoView`, and a CSS class removed after a short timeout.
import { useEffect } from "react";

export function ForYouScrollToItem({ targetId }: { targetId: string }) {
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

  return null;
}
