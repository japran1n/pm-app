# Handoff: F015 — M2 scrutiny fix: request-mode composer honesty + requests panel scroll

## Status
COMPLETE

## Assertions covered
AS-012: PASS — mentions resolve via mentionSuggestions, hard breaks kept, attachments block send with inline message, success/truncation toast shown, requests panel capped with its own scroll.

## Files changed
components/chat/message-composer.tsx
lib/comments/rich-text.ts
app/(portal)/portal/[workspaceSlug]/p/[projectId]/conversation/page.tsx
tests/unit/f015-message-composer-request-mode-rich-editor.test.tsx

## Commands run
`npx vitest run tests/unit/f015-message-composer-request-mode-rich-editor.test.tsx tests/unit/f007-messages-request-toggle.test.tsx` (0)
`npx vitest run tests/unit/rich-text.test.ts tests/integration/comment-format-realtime.test.ts tests/integration/f339-add-comment-mention-regression.test.ts` (0)
`npx tsc --noEmit -p .` (no new errors in touched files)

## Decisions made
- Picked "block" (not "carry") for queued attachments in request mode, per the task's explicit instruction, with the exact copy given.
- `extractPlainText`'s hardBreak fix lives in the shared helper (not duplicated in message-composer) since it's a genuine bug in the shared plain-text projection, not something specific to request mode — the existing comment/description callers benefit too, and no existing test asserted the old (silently-dropping) behaviour.
- Truncation is only surfaced when the truncated title actually differs from the first line (`firstLine.length > title.length`); the full untouched text still becomes the request's body/description either way, per the task's alternative-acceptable option.
- Requests panel: `max-h-64 overflow-y-auto` with a `sticky top-0` heading, matching the existing "scroll each region independently" pattern already used by the message list, rather than converting it into a collapsible `<details>` (cheaper, no state to manage, and the panel's own heading stays visible while scrolling).

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose the plain toast copy "Request sent" for the common case (given verbatim in the task) and "Request sent — the title was shortened to fit the length limit." for the truncated case, since the task left the exact truncation wording unspecified.

## Notes for the next worker
No MCP usage — pure application code + tests.
