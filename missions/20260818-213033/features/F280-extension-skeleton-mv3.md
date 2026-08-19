# F280: Chrome MV3 extension skeleton

**Milestone:** M19 — QA feedback browser extension
**Estimated worker time:** 45 minutes
**Depends on:** none

## Assertion IDs covered
- AS-531: the extension loads as MV3 and opens its popup on toolbar click

## Draft scope
- New `extension/` workspace in the repo with its own build (Vite + a CRXJS-style MV3 plugin, version verified at install time), producing a loadable unpacked build and a zip artifact.
- `manifest.json` v3: action popup, service worker, `activeTab` only — no `<all_urls>`.
- Popup shell rendering "not connected" state; no capture, no auth yet.
- The extension build must not break the Next.js app's build, lint, or typecheck.

## Files (approximate)
extension/ (new: manifest.json, src/popup, src/background, vite config), package.json scripts

## Notes for clarification
- Decide whether the extension shares the repo's tsconfig/eslint or carries its own — sharing is cheaper but MV3 globals differ from Next's.
- MCP at run: none.
