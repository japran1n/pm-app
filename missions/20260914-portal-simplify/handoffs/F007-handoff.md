# Handoff: F007 — Messages with requests folded in

## Status
COMPLETE

## Assertions covered
AS-012: PASS — checking "This is a request for new work" in the Messages composer and sending calls `onFileRequest` (wired to `createClientRequest` with `projectId` fixed to this route's own project), never the plain-message `onSend`; that action writes to `client_requests`, the same table/RLS the existing team-side requests inbox already reads unmodified. Covered by `tests/unit/f007-messages-request-toggle.test.tsx`.
AS-013: PASS — the Messages page's "Your requests" section reuses `RequestList` unmodified over `getPortalRequests(workspaceId)` filtered to this project; submitted/accepted/declined statuses and the decline reason all render. Covered by `tests/unit/f007-messages-your-requests.test.tsx` (direct `RequestList` assertions) plus the existing untouched `components/portal/request-list.test.tsx` (still green).

## Files changed
app/(portal)/portal/[workspaceSlug]/p/[projectId]/conversation/page.tsx
components/chat/channel-view.tsx
components/chat/message-composer.tsx
tests/unit/f007-messages-request-toggle.test.tsx (new)
tests/unit/f007-messages-your-requests.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint components/chat/message-composer.tsx components/chat/channel-view.tsx "app/(portal)/portal/[workspaceSlug]/p/[projectId]/conversation/page.tsx" tests/unit/f007-messages-request-toggle.test.tsx tests/unit/f007-messages-your-requests.test.tsx` (0)
`npx vitest run tests/unit/f037-message-composer-ime.test.tsx tests/unit/f-bugfix-message-composer-enter-race.test.tsx tests/unit/f123-message-composer-plain-json-boundary.test.tsx components/portal/new-request-form.test.tsx components/portal/request-list.test.tsx` (0 — 19/19 passing, confirms this feature's `MessageComposer`/`ChannelView` changes did not disturb existing behaviour)
`npx vitest run tests/unit/f007-messages-request-toggle.test.tsx tests/unit/f007-messages-your-requests.test.tsx` (0 — 6/6 passing, the new AS-012/AS-013 tests)
`npx vitest run tests/unit components/portal components/chat` (5 test files / 8 tests failed, all pre-existing and unrelated — see Notes; 438/443 files and 2935/2943 tests passed)

## Decisions made
- The actual route this feature owns (`p/[projectId]/conversation/page.tsx`, the one F008/F009 already refer to as "Messages") renders `ChannelView`/`MessageComposer` (the real-time chat channel, `lib/actions/chat-messages.ts`'s `sendMessage`), not `components/portal/conversation.tsx` (`PortalConversation`, which is the unrelated task-detail comment thread used only on `p/[projectId]/t/[taskId]/page.tsx`). The plan.md description's file reference for this feature was stale relative to the codebase; I followed the actual route/page this feature and F008/F009 describe, not the stale filename, since the assertions (AS-012/AS-013) and every sibling feature's own route references (F008's "Messages" nav item, F009's `p/requests` → `p/conversation` redirect) all point at this same conversation route.
- The composer checkbox is added to `MessageComposer` (and threaded through `ChannelView`) behind a new, entirely optional `onFileRequest` prop rather than duplicated into a second, parallel composer UI on the page. Every other caller of these two shared components (staff-side `/w/<slug>/chat/<channelId>`, and `ChannelView`'s own other portal callers, of which there are none besides this one) never passes `onFileRequest`, so they render byte-identical to before — verified by re-running every existing test that exercises either component (see Commands run) plus a new explicit "no `onFileRequest` renders no checkbox" test.
- Title/body derivation: since the rich-text composer (Tiptap) has no separate title field, the clarified spec's "derive title from the first line and keep full text as description" is implemented literally — `title` = first line of the plain-text extraction (truncated to 200 chars, `createClientRequestSchema`'s own limit), `body` = the full plain text, not the remainder after the first line.
- Filing a request reuses `createClientRequest` (the exact action `NewRequestForm`/`p/[projectId]/requests/page.tsx` already call) via a small inline Server Action (`fileMessagesRequest`, `"use server"` inside the page's own async function body) that builds a `FormData` and fixes `projectId` to this route's own project — the same "project fixed, no picker" convention `NewRequestForm`'s `fixedProjectId` prop already established, just without reusing that specific form component (whose UI is a full multi-field form, not a single-checkbox composer toggle).
- "Your requests" section: reused `RequestList` exactly as `p/[projectId]/requests/page.tsx` already wires it (`getPortalRequests(workspaceId)` filtered client-side to `projectId`, "read stays wide, this caller narrows it" — same comment convention `requests/page.tsx` documents for the identical filter). No new query, no new component.
- Header: "Messages" / "Talk to the team, or ask for something new." rendered above both the empty-channel state and the loaded `ChannelView`, so the page's title is consistent regardless of whether a channel exists yet.
- Did not touch the sidebar (`components/portal/portal-sidebar.tsx`) or add any redirect from `p/requests` — both explicitly out of scope per this feature's own instruction (F008/F009's job).
- `p/[projectId]/requests/page.tsx` (the old dedicated requests page) is untouched and still live; F009 is responsible for redirecting it, not this feature.

## Out-of-scope work needed
- F008 (four-item sidebar): should route "Messages" to this same `p/conversation` path.
- F009 (old routes redirect): `p/requests` → `p/conversation` still needs to be added; until then both routes coexist (the old one still works, unredirected).
- F010 (Home callout + wording): unrelated to this feature's own copy; not touched here.
- Not done, flagged for awareness (pre-existing, unrelated): 5 test files / 8 tests fail across the wider suite with `cookies() called outside a request scope` in `lib/queries/custom-fields.ts` (`task-detail-sheet-dependencies-comments-removed.test.tsx`, `board-taskid-deeplink.test.tsx`, `f246-task-detail-sheet-copy-link.test.tsx`) — same class of pre-existing failure F006's handoff already documented for a different set of files; none reference `conversation`, `message-composer`, `channel-view`, or `client-requests`.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Followed the actual "Messages" route (`p/[projectId]/conversation` using `ChannelView`/chat) rather than the plan.md text's literal `components/portal/conversation.tsx` reference, since that component is unrelated (task-detail comment thread) and every sibling feature (F008 nav item, F009 redirect target) points at the chat-backed conversation route as "Messages". Explained fully under Decisions made above; not treated as a silent override of a clarified answer since no separate F007 clarification file exists (plan.md's own paragraph is the only spec, and its route intent — not its incidental file citation — is unambiguous from the surrounding features).
AUTONOMOUS_DECISION: Implemented the checkbox as an optional prop on the shared `MessageComposer`/`ChannelView` (gated so no other caller is affected) rather than building a second, portal-only composer component, since the clarified spec's literal wording is "composer gains a checkbox" (singular, existing composer), not "a new composer is added alongside it".

## Notes for the next worker
- No MCP tools were used — this feature only touches client_requests via the existing `createClientRequest`/`getPortalRequests` code paths (no schema change, no new table/policy).
- `MessageComposer`'s new `onFileRequest` prop signature: `(payload: { title: string; body: string }) => Promise<{ ok: boolean; error?: string }>`. `ChannelView` forwards it under the same name. The Messages page's own `fileMessagesRequest` inline Server Action is the only caller today.
- If a future worker wants attachments to be disallowed while the "request" checkbox is checked (not required by AS-012/AS-013 and not implemented), that would be a small addition to `MessageComposer`'s attach-button `disabled` condition.
