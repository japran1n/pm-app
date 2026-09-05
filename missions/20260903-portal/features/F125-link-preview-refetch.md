# F125: Link previews are refetched on every render

**Milestone:** post-portal — **performance**
**Estimated worker time:** 2 h
**Assertions:** AS-086, AS-087, AS-088
**Opened by:** measured in the dev server log during the user's own
testing

## Evidence

From the running app's request log, during ordinary chat use:

    ƒ getLinkPreview("https://youtu.be/W4drPiXwlyc?si=...") in 1082ms
    ƒ getLinkPreview("https://www.youtube.com/watch?v=...") in  463ms
    ƒ getLinkPreview("https://youtu.be/W4drPiXwlyc?si=...") in  513ms
    ƒ getLinkPreview("https://www.youtube.com/watch?v=...") in  417ms
    ƒ getLinkPreview("https://www.flowninja.com/")          in  344ms
    ƒ getLinkPreview("https://www.flowninja.com/")          in  166ms

The same URLs are fetched repeatedly. `components/chat/link-preview-card.tsx`
has only a module-level `Map`, which lives per browser tab — it does not
survive navigation, a reload, or a second viewer, so in practice almost
every render refetches.

**The YouTube case is the worst:** F120's own cap reads up to 512 KB of
a 1.4 MB page and finds no Open Graph tags at all (they sit ~682 KB in).
So that ~1 second buys nothing, and is paid again on every render.

## Scope

1. **Cache resolved previews server-side (AS-086)** so the result is
   shared across renders, viewers and page loads — not per browser tab.
   Choose the mechanism deliberately and justify it in the handoff:
   Next's own data cache (no schema change) or a `link_previews` table
   (survives restarts, and is the direction F120's own handoff already
   suggested). Either is acceptable; a per-tab Map is not.
   Give entries a sensible expiry — a link's title can change.
2. **Cache negative results too (AS-087).** A URL that yields nothing
   usable — no OG tags, unreachable, timed out, blocked host — must be
   remembered as "nothing here" so it is not refetched every render.
   Use a shorter expiry than for successes, since a failure is more
   likely to be temporary. The YouTube case above is exactly this:
   currently ~1 second of wasted download, repeatedly, forever.
3. **Never block the message on the preview (AS-088).** A message must
   render immediately; the preview may appear afterwards. Verify this
   is already true and keep it true — if the current implementation
   makes the message wait, that is part of this fix.
4. Once caching exists, the per-tab `Map` in `link-preview-card.tsx`
   becomes redundant. F120's own handoff says so explicitly ("can be
   deleted entirely" once a server-side cache lands). Remove it rather
   than leaving two caches.

## Out of scope

- Raising the 512 KB read cap, or adding a YouTube-specific oEmbed
  path. The user was asked and said YouTube previews are not important.
  Do not add them. Caching the negative result is the fix here.
- The autolink/href chain (F120/F122/F123) — settled, do not touch.
- SSRF hardening, per-workspace rate limiting — still open from F120's
  handoff, still out of scope.

## Definition of done

- AS-086/AS-087 tested: a second call for the same URL does not perform
  a second network fetch, for both a successful and an unsuccessful
  URL.
- Verified in the running app (dev server is on port 3000 — do not
  start another) that opening a channel with previously-seen links
  produces no repeated `getLinkPreview` work in the log. Paste the
  before/after log lines in the handoff.
