# F119: Sidebar is cramped on short/narrow viewports

**Milestone:** post-portal — **bug fix**
**Estimated worker time:** 1–2 h
**Assertions:** AS-069
**Opened by:** the user, screenshot of a team-member sidebar on a narrow
viewport showing the projects list cut off after 2-3 rows with no
visible scroll affordance

## Report, verbatim

"kada je neko radnik a ne klijent njihov bar izgleda cudno, nema
prostora, npr ne vide se svi projekti sve je nekako nabacano" — the
team-member sidebar (not the client portal sidebar) looks cramped, no
room, not all projects visible, everything crowded together.

## What's already there

`components/nav/app-sidebar.tsx` was NOT touched by the recent chat
merge — confirmed via `git diff` — this is pre-existing, unrelated to
that work.

The file already has a documented intent (see its own comments around
line 280–366, "AS-512"): the primary nav (Dashboard/My Tasks/Projects/
Chat/Calendar/.../Trash) is meant to be a fixed-height block, and the
Projects section below it (`ProjectNavList`, wrapped in
`flex min-h-0 flex-1 flex-col`) is meant to be the one section that
grows and scrolls independently.

The likely gap: on a short viewport (or a workspace with a long primary
nav — this workspace has ~12 items: Dashboard, My Tasks, Projects, Chat,
Calendar, Timeline, Time, Members, Client requests, Approvals, Archive,
Templates, Trash), the fixed primary nav plus the header and footer can
leave `flex-1 min-h-0` with almost no height, and something in that
chain isn't giving the Projects list a real scroll container at that
size, or isn't giving the primary nav itself a scroll fallback when
even IT doesn't fit. Read the full component and its own AS-512 comment
before changing anything — a previous fix in this exact file (the
"BUGFIX" comment right above it) was itself about a stale
`overflow-y-auto` interacting badly with a `flex flex-col` child, so
this area has a documented history of these interactions.

## Scope

1. Reproduce at a short viewport height with the full ~12-item primary
   nav a workspace like the one in the report would have (many
   optional items enabled: Members, Client requests, Approvals all
   visible — check `navGroups()` for what's role-gated vs. always on).
2. Fix so that:
   - Every primary nav item is always visible (never itself cut off).
   - The Projects section scrolls independently within its own
     container and every project is reachable.
   - No spurious/nested scrollbar reappears — re-read the existing
     BUGFIX comment about `overflow-y-auto` creating an independent
     scroll container on a `flex flex-col` child; don't reintroduce
     that.
3. If the primary nav itself cannot fit on very short viewports even
   after this fix, that primary nav becomes the thing that scrolls (not
   both fighting for space) — but only as a last resort, since AS-512's
   original intent was to keep it fixed. Note in the handoff which case
   you hit and why.

## Out of scope

- The client portal sidebar (`components/portal/portal-sidebar.tsx`) —
  the report is specifically about the team-member nav.
- Any chat-related file — unrelated, a different session owns that
  code concurrently in the same repo; do not touch `components/chat/*`.
- Redesigning the nav's information architecture (grouping, item
  order). This is a layout/overflow bug, not a redesign.

## Definition of done

- AS-069 has a passing test (component/DOM-level: constrain viewport
  height, assert the projects list container has its own scroll
  affordance and all seeded projects are present in the DOM /
  reachable).
- Manually verified in a real narrow/short viewport (resize the browser
  or use a mobile preset) that all primary nav items and all projects
  are reachable, with no double/nested scrollbar.
- `npx tsc --noEmit` passes; existing sidebar tests (if any) still pass.
