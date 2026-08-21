# PM-App QA Feedback — permissions justification

This document is the store-listing-reusable justification for every
permission, host permission, and content script the extension declares. It
was audited against the built `dist/manifest.json` on 2026-08-21 (F298).
Nothing broader than what is listed below is declared anywhere in the
manifest — in particular, `<all_urls>` never appears.

## Permissions

- **`activeTab`** — grants temporary access to the single tab the user is
  looking at, and only immediately after the user interacts with the
  extension (clicking its toolbar icon opens the popup, which is itself the
  qualifying gesture). Used for `chrome.tabs.captureVisibleTab`
  (screenshotting the tab the reporter is looking at) and as the
  fallback/primary basis for `chrome.scripting.executeScript` calls (element
  picking) on arbitrary pages the reporter chooses to report a bug on. This
  is the narrowest permission Chrome offers for "the page the user is
  currently looking at, only when they act" — no persistent or background
  tab access is requested.
- **`storage`** — used for `chrome.storage.local` only (never `sync`), to
  hold the reporter's session token after the one-time web-app handoff
  between popup opens. Nothing is synced to a Google account or any server
  other than this app's own API.
- **`scripting`** — required to call `chrome.scripting.executeScript`,
  which injects the element-picker code into the current page **on
  demand**, only when the reporter explicitly triggers "pick element". No
  content script from this permission runs automatically or on every page
  load — it only runs when invoked, scoped to the single tab the call
  targets.

## Host permissions

- **`http://localhost:3000/*`** — scoped to this app's own origin only
  (the same origin the extension is built to talk to; see
  `tech-decisions.md`). This is what lets `chrome.scripting.executeScript`
  target that origin without requiring the exact toolbar-icon gesture
  `activeTab` demands (Chrome allows script injection into a
  `host_permissions`-covered origin without a fresh gesture) — used
  specifically for the one-time session-handoff content script below. It
  does not grant any access to any other site the reporter visits.

## Content scripts (`content_scripts`)

- **One entry, matching `http://localhost:3000/extension-connect*` only**
  — this is the one content script that is NOT injected on demand via
  `chrome.scripting.executeScript`. It runs automatically, but only on the
  app's own one-time "extension connect" handoff page, because that page's
  entire job is to hand a fresh session token to the extension the moment
  the reporter lands on it after signing in — there is no user gesture
  aimed at the extension itself at that point (no toolbar click has
  happened yet), so `activeTab`'s gesture-only model cannot cover this case.
  This is a deliberate, narrow exception to the "on-demand injection"
  pattern used everywhere else in this extension, not the same category as
  the on-demand `chrome.scripting.executeScript` calls: it is scoped to one
  exact path on the extension's own origin, runs once per handoff, and
  reads nothing from the page except the token the app itself placed there
  for this purpose. It never runs on any other site or path.

## What the extension can and cannot see (plain language)

**The extension can only see the page you are actively looking at when you
click its toolbar icon or explicitly start a capture — it cannot read pages
in other tabs, browse your browsing history, or run in the background on
pages you have not interacted with.**

Specifically:

- It can take a screenshot of the tab you are currently viewing, but only
  right after you click the extension's icon — it cannot screenshot any
  other tab, and it cannot take a screenshot later without you clicking the
  icon again.
- It can read the position, size, and a CSS selector for one element on the
  current page, but only after you explicitly click "pick element" and then
  click that element yourself — it does not read the page's contents
  otherwise, and stops listening the moment you pick or cancel.
- It never runs automatically on pages you have not chosen to interact with
  — the one exception is the app's own one-time sign-in handoff page
  (`localhost:3000/extension-connect`), where it only ever reads the
  one-time token that page itself placed there for the extension to pick
  up.
- It stores your session token locally in the browser
  (`chrome.storage.local`); nothing is synced to a Google account, and
  nothing is sent anywhere except this app's own server when you submit a
  report.
- It cannot access `chrome://` pages, the Chrome Web Store, or other
  browser-internal pages — Chrome blocks extensions from those regardless
  of permissions, and the extension explains this plainly if you try.
