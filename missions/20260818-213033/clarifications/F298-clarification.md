# F298 Clarification

_Generated: 2026-08-19T11:00:00Z_  _Mode: accept-and-continue (M19, planned 2026-08-19)_
_Answered by: orchestrator on standing user authorization — starred defaults, no interactive round._

## Deltas and standing answers

- Pattern: follow the decisions recorded in `missions/20260818-213033/tech-decisions.md` § QA feedback extension — MV3, popup (not side panel), `activeTab` only, session handoff from the web app, `chrome.storage.local` storage adapter, one narrow authenticated Route Handler, uploads with the user's own JWT.
- Validation: Zod at every server boundary; the extension re-checks nothing the server does not also check.
- Access control: the server resolves the user from the JWT and ignores any identity in the payload.
- Failure handling: every failure states what happened and preserves the reporter's work; no silent no-ops.
- Open questions in the feature's "Notes for clarification" are resolved by taking the simpler, more private option (less data captured, narrower permission, redact by default) and recording the choice in the handoff's Decisions Made.

## Definition of done

- Tests for the assigned assertions, named with their IDs; Playwright with the unpacked extension loaded where the assertion is about real browser behaviour.
- No secret key in any built artifact.
- `npx tsc --noEmit` and `npx eslint .` clean for both the app and the extension workspace.
