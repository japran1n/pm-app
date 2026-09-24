# PM-App QA Feedback — permissions justification

This document is the store-listing-reusable justification for every
permission, host permission, and content script the extension declares.
Re-audited against the source on 2026-09-24 (audit SEC-EXT-08: the previous
version justified `scripting` with an "element picker" feature that was
never reachable from the UI; that dead code has been deleted). Nothing
broader than what is listed below is declared anywhere in the manifest — in
particular, `<all_urls>` never appears.

`<app origin>` below is the pm-app origin the extension is built for
(`VITE_APP_URL` at build time, production by default — see
`vite.config.ts`).

## Permissions

- **`activeTab`** — grants temporary access to the single tab the user is
  looking at, and only after the user interacts with the extension
  (clicking its toolbar icon opens the popup, which is the qualifying
  gesture). Used for `chrome.tabs.captureVisibleTab` (screenshotting the tab
  the reporter is looking at) and as the host access for the two
  `chrome.scripting.executeScript` calls below on whatever page the reporter
  is filing a bug about.
- **`storage`** — `chrome.storage.local` only (never `sync`). Holds the
  extension's own session (see "Session" below), the last-used
  workspace/project, an unsent report draft, and a just-captured screenshot
  while the popup is closed during region selection. Everything is cleared
  on "Disconnect".
- **`scripting`** — required for `chrome.scripting.executeScript`, used on
  demand in exactly two places, both on the active tab only:
  1. **Region selection** (`src/capture/region-overlay.ts`): when the
     reporter clicks "Select area to capture", a temporary overlay is
     injected so they can drag a rectangle; it removes itself when they
     finish or press Escape.
  2. **Page context** (`src/capture/page-context.ts`): when the reporter
     submits a report, the page's URL, viewport size and device pixel ratio
     are read so the task describes the page under test rather than the
     popup.
  No script from this permission runs automatically or on page load.

## Host permissions

- **`<app origin>/*`** — the app's own origin only. Lets the background
  service worker call the app's session-handoff endpoint
  (`/extension-connect/exchange`, which deliberately sends no CORS headers
  for web pages) and lets the one content script below run on the connect
  page. It grants no access to any other site the reporter visits.

## Content scripts (`content_scripts`)

- **One entry, matching `<app origin>/extension-connect*` only** — runs
  automatically on the app's own "connect the extension" page, because
  that page's whole job is to hand a one-time, 60-second, single-use
  connect code to the extension right after the user signs in; there is no
  toolbar gesture at that point, so `activeTab` cannot cover it. It only
  reads that one code from the page and never runs on any other site or
  path.

## Session

The connect code carries no credentials. The server redeems it once and
mints a **separate** session for the extension, so the extension never
holds (or rotates, or revokes) the user's browser session. "Disconnect"
signs out that extension session only (`scope: "local"`) and clears
`chrome.storage.local`.

The extension session is stored in `chrome.storage.local`, so the extension
stays connected across browser restarts. `chrome.storage.session` would be
cleared on every restart and force a reconnect each time; the trade-off was
judged not worth it. `chrome.storage.local` is readable only by this
extension's own pages, worker and content script (which runs only on the
connect page) — not by websites.

## What the extension can and cannot see (plain language)

**The extension can only see the page you are actively looking at when you
click its toolbar icon and start a capture or submit a report — it cannot
read pages in other tabs, browse your browsing history, or run in the
background on pages you have not interacted with.**

Specifically:

- It can take a screenshot of the tab you are currently viewing, but only
  right after you click the extension's icon.
- When you submit a report it reads that page's address, window size and
  pixel ratio. By default only the address's origin and path go into the
  task — the query string and `#fragment` (which can contain sign-in codes
  or tokens) are dropped unless you tick "Include full page URL".
- It never runs automatically on pages you have not chosen to interact with
  — the one exception is the app's own connect page, where it only reads
  the one-time code that page placed there for it.
- Your extension session is stored locally in the browser
  (`chrome.storage.local`); nothing is synced to a Google account.
- It contacts no server other than this app and its Supabase project — no
  analytics, and no web fonts or other third-party resources.
- It cannot access `chrome://` pages, the Chrome Web Store, or other
  browser-internal pages — Chrome blocks extensions from those regardless
  of permissions, and the extension explains this plainly if you try.
