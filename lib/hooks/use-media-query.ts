"use client";

// F265 (AS-516): a small, dependency-free `matchMedia` hook — no new
// package (e.g. `usehooks-ts`) per the clarification's "simpler option,
// no new dependency" rule; this is the one place in the codebase that
// needs to know the CURRENT viewport width in JS (not just via CSS
// classes), because collapsible sections need to force themselves open
// once the viewport crosses back above the mobile breakpoint even if the
// user had collapsed one while narrow (see task-detail-sheet.tsx's
// `MobileCollapsibleSection`) — a pure-CSS `max-sm:` class can't express
// "ignore JS state above this breakpoint".
//
// SSR-safe: starts `false` (matches server render, avoids a hydration
// mismatch) and syncs to the real value in an effect after mount, same
// "no server/client markup mismatch" convention other client-only-state
// hooks in this codebase follow.
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    // Defensive: this codebase's jsdom test environment does not
    // implement `matchMedia` by default (unlike a real browser) and this
    // hook has no matchMedia polyfill of its own to install (no new
    // dependency, per the clarification's "simpler option" rule) — tests
    // that need a real value stub `window.matchMedia` themselves. A
    // caller in an environment without it stays at the initial `false`
    // (matches server render / desktop-safe default) rather than
    // throwing.
    if (typeof window.matchMedia !== "function") return;
    const mediaQueryList = window.matchMedia(query);
    const update = () => setMatches(mediaQueryList.matches);
    update();
    mediaQueryList.addEventListener("change", update);
    return () => mediaQueryList.removeEventListener("change", update);
  }, [query]);

  return matches;
}

// F265 (AS-516): the SAME breakpoint convention `max-sm:`/`sm:` Tailwind
// utilities already use across this codebase (F264's board carousel,
// this feature's own full-screen Sheet) — Tailwind v4's default `sm`
// breakpoint is `40rem` (640px), so "below sm" is `max-width: 639.98px`.
export const MOBILE_BREAKPOINT_QUERY = "(max-width: 639.98px)";
