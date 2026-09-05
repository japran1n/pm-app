# F120: Three chat bugs found in testing right after the parity merge

**Milestone:** post-portal — **bug fix**
**Estimated worker time:** 3–4 h
**Assertions:** AS-070 … AS-073
**Opened by:** the user, testing on localhost immediately after
`feat/chat-slack-parity` was merged into main

## Context

This feature touches `components/chat/*` and related files, which were
just built by a concurrent Claude session (`pm-app-cf`, worktree
`pm-app-chat`, branch `feat/chat-slack-parity`, already merged into
main at commit `be8e03b`). That session has been notified this feature
is starting and asked to hold off on the same files. Read
`docs/chat-slack-parity-plan.md` (that session's own plan doc, already
in the repo) before touching anything, to understand what was actually
built and why, rather than re-deriving intent from the diff alone.

## Bug 1 — duplicate messages (AS-070)

Reported: sending messages as a workspace member ("Luka Petrović", not
the client-role "You" account), every message appears TWICE in the
channel/thread — a screenshot showed 4 rows for 2 actual sends.

Likely cause to check first: an optimistic local insert on send that
is never reconciled with (or deduplicated against) the row that arrives
back over Realtime — so the sender sees their own message twice while
everyone else sees it once. Check `lib/actions/chat-messages.ts` and
wherever `message-list.tsx` / `thread-panel.tsx` merges optimistic state
with Realtime-delivered rows. Confirm the fix by testing both as the
sender and as a second session/observer — a fix that only de-dupes the
sender's own view but still double-inserts server-side would be wrong.

## Bug 2 — links not recognized, and a requested preview card (AS-071, AS-072)

Reported: pasting a bare URL (a YouTube link was the test case) renders
as inert plain text — not a clickable link at all.

This repo already has `components/chat/use-rich-text-renderer.ts` from
the parity merge — read it first; the gap may be that it renders rich
text from the editor's own marks but never autodetects a bare URL that
was typed as plain text without going through a link toolbar button.

Two things to fix, at two different levels of certainty:
- **AS-071 (definite bug):** a bare URL must render as a clickable
  anchor, full stop. This must work even if AS-072 below turns out to
  be too large to fit this feature's scope.
- **AS-072 (feature the user asked for, larger, best-effort):** for a
  URL Server-side fetchable within a short timeout, fetch its Open
  Graph tags and render a small preview card (title, and image/site
  name if easily available) under the message. If fetching fails, times
  out, or the target has no OG tags, the message must still render as
  a plain clickable link with no visible error — never a broken card,
  never a stuck loading state. Keep this server-side (a Server Action
  or route handler fetching the URL), not a client-side fetch of
  arbitrary third-party URLs, to avoid mixed-content/CORS dead ends and
  to keep the request path auditable. If a proper solution needs
  meaningfully more than this feature's time budget (e.g. persistent
  caching of fetched metadata, handling redirects/paywalls robustly),
  ship a straightforward synchronous-fetch-with-timeout version and say
  in the handoff what a hardened version would additionally need.

## Bug 3 — layout/scroll instability in the channel view (AS-073)

Reported: entering a channel produces a whole-PAGE scroll, and
depending on scroll position the channel's own toolbar sometimes
disappears, sometimes reappears — the classic symptom of two nested
scroll containers (an outer page-level one and the channel's own
internal message-list one) both trying to own scrolling, or a container
missing a height constraint so its content pushes the page down instead
of scrolling internally.

Check `app/(workspace)/w/[workspaceSlug]/chat/[channelId]/page.tsx` and
`components/chat/channel-view.tsx` for the height/overflow chain: the
message list needs a bounded height (`flex-1 min-h-0` or equivalent)
inside a fixed-height ancestor, with `overflow-y-auto` on the message
list only, not on any ancestor. `components/nav/app-sidebar.tsx` (a
different, unrelated file, being fixed in parallel as F119) has
detailed comments about exactly this failure mode from an earlier bug
in this codebase — read them as a reference for the shape of the fix,
even though that file itself is out of scope here.

## Scope

- `components/chat/*`
- `lib/actions/chat-messages.ts`, `lib/queries/chat.ts`
- `app/(workspace)/w/[workspaceSlug]/chat/[channelId]/page.tsx`
- A new server-side OG-fetch helper if AS-072 needs one (e.g.
  `lib/chat/link-preview.ts` or similar — your call on naming/location,
  follow this repo's existing `lib/` conventions).

## Out of scope

- `components/command/*`, `app-sidebar.tsx`, `components/portal/*` —
  untouched, unrelated.
- Notification sound/preferences work from the parity merge — not
  reported as broken, leave alone.
- Redesigning the chat UI beyond what's needed to fix these three bugs.

## Definition of done

- AS-070 through AS-073 each have a passing test.
- AS-070 specifically tested with a real send-and-observe (not just
  reading the dedup logic) — reload the page after sending and confirm
  count stays at one.
- AS-072's failure path (unreachable/no-OG-tags URL) has its own test,
  not just the happy path.
- `npx tsc --noEmit` passes; existing chat tests still pass.
