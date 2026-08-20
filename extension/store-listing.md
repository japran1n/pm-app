# PM-App QA Feedback — Chrome Web Store listing checklist

This document collects everything a Chrome Web Store listing conventionally
needs (verified against `developer.chrome.com/docs/webstore/*` and
`developer.chrome.com/docs/extensions/reference/manifest/icons`, 2026-08-21),
so a human publisher can fill in the Developer Dashboard form without having
to re-derive any of it.

## Item identity

- **Name:** PM-App QA Feedback
- **Version:** read from `extension/package.json`'s `"version"` field — the
  single source of truth. The build (`npm run build` in `extension/`, or
  `npm run build:extension` from the repo root) runs
  `scripts/sync-version.mjs` first, which overwrites `manifest.json`'s
  `version` field from `package.json` before every build, so the two numbers
  can never independently drift. `manifest.json`'s field itself cannot be
  removed (Chrome requires it directly in the manifest), it is just no
  longer hand-maintained.
- **Category:** Developer Tools (this is an internal QA/bug-reporting tool
  for a project-management app, not a consumer product).
- **Short description (<=132 chars):** "Capture QA feedback — screenshot,
  console logs, and page context — and file it as a pm-app task without
  leaving the page."
- **Detailed description:** Lets a signed-in pm-app teammate report a bug or
  QA issue directly from any page of the app under test: click the toolbar
  icon, optionally capture a screenshot, pick a page element, and/or record
  recent console/network activity, then submit — the extension files a task
  in pm-app with that context attached. Built for internal team use during
  QA passes; requires an existing pm-app account and an active session
  (established once via the app's own sign-in flow).

## Icons

- `extension/public/icons/icon16.png`, `icon48.png`, `icon128.png` — the
  three sizes Chrome's manifest schema requires/recommends (verified via
  `developer.chrome.com/docs/extensions/reference/manifest/icons`,
  2026-08-21: 16x16 favicon/extensions-page size, 48x48 extensions-management
  page, 128x128 install dialog and Chrome Web Store listing icon). These are
  simple placeholder artwork (a flat indigo rounded square with a white
  centre mark) — adequate for an internal tool; not intended as final brand
  design. `manifest.json` references them both under the top-level `icons`
  field (extensions management page) and under `action.default_icon`
  (toolbar button — previously missing per F280's skeleton, which meant
  Chrome showed a generic default toolbar icon; fixed in this feature).
- The Chrome Web Store dashboard additionally requests a **128x128 store
  icon** at upload time — `icon128.png` above satisfies this directly (same
  file, same size requirement per
  `developer.chrome.com/docs/webstore/images`, 2026-08-21).

## Screenshots / promotional images

- **Not produced by this feature.** The Chrome Web Store dashboard requests
  at least one 1280x800 (or 640x400) screenshot and optionally a 440x280
  small promo tile (verified via
  `developer.chrome.com/docs/webstore/images`, 2026-08-21). This feature
  cannot take real product screenshots (no design/product-photography step
  in scope). **Placeholder note:** before publishing, the human publisher
  should take 1-3 real screenshots of the popup mid-flow (e.g. the picker
  active on a real page, the report form filled in) at 1280x800 and upload
  them at that step — nothing else in this checklist depends on that being
  done first.

## Privacy disclosure

Reuse `extension/PERMISSIONS.md` verbatim — it already contains a
plain-language "what the extension can and cannot see" section written for
a non-technical audience, which is exactly what the Chrome Web Store's
privacy-practices tab asks a publisher to describe. Do not rewrite it here;
link/copy it in at publish time so there is exactly one place this text is
maintained (same "one source of truth" principle as the version number
above). See `extension/PERMISSIONS.md` for:

- Per-permission justification (`activeTab`, `storage`, `scripting`)
- The one `host_permissions` entry and why it's needed
- The one `content_scripts` entry and why it's a deliberate, narrow
  exception to the on-demand-injection pattern
- The full "can/cannot see" disclosure section, ready to paste into the
  Chrome Web Store's "Single purpose" and "Permission justification" fields

## Single purpose statement

Chrome Web Store requires a one-sentence "single purpose" justification for
the whole extension (separate from per-permission justifications): *"Capture
in-page QA feedback (screenshot, picked element, console/network activity)
from the page a signed-in pm-app teammate is looking at, and file it as a
pm-app task."*

## Distribution / visibility

Per this feature's clarification (simpler, more private option preferred):
publish first as **unlisted** — installable only via direct link, not
searchable in the store, no public review queue exposure — which matches
this extension's actual audience (this project's own QA team) rather than
the general public. A public listing is not a requirement for this
extension to function and is not recommended as the first step. See the
root `README.md` "Publishing the extension" section for what a human must
do to actually get to that point (account registration, fee, review time —
none of which the orchestrator/AI can do).

## Data disclosure form fields (Chrome Web Store "Privacy practices" tab)

Per `developer.chrome.com/docs/webstore/*` (2026-08-21), the dashboard asks
publishers to explicitly declare what user data is collected. Based on
`PERMISSIONS.md`'s audit, this extension collects:

- **Website content** — yes, but only on-demand and only for the tab the
  reporter is actively reporting on (screenshot pixels, one picked
  element's selector/position, console/network log lines the reporter
  chose to capture). Never collected in the background or on pages the
  reporter did not choose to interact with.
- **Authentication information** — yes, a session token, stored locally via
  `chrome.storage.local` only, never synced to a Google account, sent only
  to this app's own API.
- **Personally identifiable information** — no additional PII beyond what
  the reporter's own pm-app account already has.
- Certify: data is not sold to third parties; data is not used for purposes
  unrelated to the extension's single purpose above; data is not used to
  determine creditworthiness or for lending purposes. (All true given the
  above.)
