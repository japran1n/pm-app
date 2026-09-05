"use client";

// Faza D (docs/chat-slack-parity-plan.md, D6): a visual "you have unread
// notifications" signal that's visible even when the tab isn't focused or
// the bell isn't in view -- the browser tab's title and favicon, the same
// two surfaces every mainstream chat/email web app uses for this. Explicitly
// NOT a system/OS push notification (out of this feature's stated scope) --
// this only ever touches document.title and the favicon <link> tags, both
// purely in-page DOM state.
//
// Two things this module works around, found by testing against the real
// dev server (not just reasoned about):
//
//   1. app-sidebar.tsx mounts TWO NotificationBell instances at once
//      (desktop header + `md:hidden` mobile top bar), so this hook runs
//      twice concurrently. All the shared state below is module-level
//      (not per-hook-instance) -- two independent "capture the original
//      title" snapshots would each treat the OTHER instance's
//      already-badged title as "the original" and prefix it a second
//      time ("(1) (1) Goodguys Studio"). Every mounted instance reports
//      its own count into a shared map; the badge shown is the max
//      across instances.
//   2. Next.js's own App Router route-title metadata rewrites
//      `document.title` on every client-side navigation, independent of
//      React's render/effect cycle -- if the unread count doesn't
//      change across that navigation, this hook's own effect never
//      re-fires (its only dependency is the count), so a badge applied
//      before the navigation would otherwise sit there un-reapplied
//      against the NEW route's title, or -- observed in practice --
//      silently lost the moment Next's own title write lands after this
//      hook's. A MutationObserver on the <title> element is the fix:
//      any title change this module didn't itself just make is treated
//      as a new "base" title to badge, reapplied immediately.
import { useEffect, useId } from "react";

const FAVICON_SELECTOR = 'link[rel="icon"]';
const BADGE_PREFIX_PATTERN = /^\((?:\d+|99\+)\) /;

let baseTitle: string | null = null;
let titleObserver: MutationObserver | null = null;
let originalFaviconHrefs: Map<HTMLLinkElement, string> | null = null;
const unreadCountByInstance = new Map<string, number>();

function totalUnread(): number {
  return Math.max(0, ...unreadCountByInstance.values());
}

function buildBadgedFaviconDataUrl(baseImage: HTMLImageElement): string | null {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(baseImage, 0, 0, size, size);

  // Small red dot, bottom-right, with a thin white ring so it reads
  // against both light and dark favicon artwork.
  const dotRadius = size * 0.2;
  const cx = size - dotRadius - 2;
  const cy = size - dotRadius - 2;
  ctx.beginPath();
  ctx.arc(cx, cy, dotRadius + 3, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#ef4444";
  ctx.fill();

  return canvas.toDataURL("image/png");
}

function badgeFaviconLink(link: HTMLLinkElement, originalHref: string): void {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.onload = () => {
    const dataUrl = buildBadgedFaviconDataUrl(image);
    if (dataUrl) link.href = dataUrl;
  };
  image.onerror = () => {
    // A favicon that can't be canvas-read (e.g. cross-origin without CORS
    // headers, or an SVG source some browsers refuse to taint-check) just
    // keeps its current href -- the title badge still carries the signal.
  };
  image.src = originalHref;
}

function applyFavicon(total: number): void {
  if (!originalFaviconHrefs) {
    const map = new Map<HTMLLinkElement, string>();
    document
      .querySelectorAll<HTMLLinkElement>(FAVICON_SELECTOR)
      .forEach((link) => map.set(link, link.href));
    originalFaviconHrefs = map;
  }
  for (const [link, href] of originalFaviconHrefs) {
    if (total > 0) badgeFaviconLink(link, href);
    else link.href = href;
  }
}

function applyTitle(): void {
  if (baseTitle === null) return;
  const total = totalUnread();
  const desired = total > 0 ? `(${total > 99 ? "99+" : total}) ${baseTitle}` : baseTitle;
  if (document.title !== desired) {
    document.title = desired;
  }
  applyFavicon(total);
}

function ensureTitleObserver(): void {
  const titleEl = document.querySelector("title");
  if (!titleEl) return;

  if (baseTitle === null) {
    baseTitle = BADGE_PREFIX_PATTERN.test(document.title)
      ? document.title.replace(BADGE_PREFIX_PATTERN, "")
      : document.title;
  }

  if (titleObserver) return;
  titleObserver = new MutationObserver(() => {
    // Our own applyTitle() writes are badge-prefixed; an unprefixed
    // change is Next.js's route-title metadata (or anything else)
    // overwriting the tab title out from under this module -- adopt it
    // as the new base and reapply the badge on top of it immediately.
    if (BADGE_PREFIX_PATTERN.test(document.title)) return;
    baseTitle = document.title;
    applyTitle();
  });
  titleObserver.observe(titleEl, { childList: true });
}

/**
 * While the combined unread count across every mounted instance is > 0:
 * prefixes `document.title` with "(N)" (capped "99+"), and swaps every
 * favicon <link> for a version with a small red dot drawn onto it. Both
 * revert to their original value once every instance reports 0 (or
 * unmounts without reporting a positive count). Stays correct across
 * client-side navigations even when the unread count itself doesn't
 * change (see the MutationObserver note above).
 */
export function useUnreadBadge(unreadCount: number): void {
  const instanceId = useId();

  useEffect(() => {
    if (typeof document === "undefined") return;

    ensureTitleObserver();
    unreadCountByInstance.set(instanceId, unreadCount);
    applyTitle();

    return () => {
      unreadCountByInstance.delete(instanceId);
      applyTitle();
    };
  }, [instanceId, unreadCount]);
}
