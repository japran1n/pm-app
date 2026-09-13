# Description

_Captured: 2026-09-13_

Pages under `/w/*` take 1.4–9.3 s to first byte on the local dev server while
unauthenticated pages take 30 ms. A measured audit (23 routes × 3 passes, plus
direct query timing from Node and `EXPLAIN` from the database) established the
cause: one page render issues 24–33 Supabase round trips **in sequence**, and
each round trip from this machine to the eu-west-1 project costs ~110 ms. The
database itself answers the layout's queries in under 2 ms — the cost is the
number of sequential trips, not the work done at either end.

This mission removes sequential trips. It is a pure refactor: no page gains,
loses, or changes a single visible behaviour. The scope test for every change
is the same one this repo applies to design-system work — *would a user who
knows the app by heart need to learn anything new?* If yes, it is out of scope.

Four mechanisms carry almost all the latency:

1. **Nothing is deduplicated within a request.** `auth.getUser()` is a network
   call and runs 12 times per request; the workspace row is fetched by slug 13
   times; the chat channel chain runs 3 times on chat routes. React's `cache()`
   is used in exactly one place.
2. **The workspace layout awaits an 11-step chain before returning JSX.** Next
   passes the page to the layout as `children`, so no page under `/w/*` can
   begin rendering — and no `loading.tsx` can show — until that chain finishes.
   The `Promise.all` at its centre is gated by its slowest member, which is
   itself an 8-step sequential chain.
3. **Sidebar badges fetch full records to print a number.** The unread-message
   badge walks memberships → channels → summaries → participant name
   resolution. The approvals badge fetches rows, requester names and task
   titles, then calls `.length`.
4. **Three queries scan whole tables through RLS.** Calendar status options
   scan 30,998 rows to return 22 (995 ms). The workspace task list filters
   through a join instead of `project_id`, so RLS evaluates all 4,738 tasks
   (323 ms).

Separately, the list route answers a request with a redirect to itself, which
replays the proxy and both layouts — which is why clicking into the list
(3.15 s) is slower than loading it cold.

Out of scope, deliberately: collapsing the 29 tables with duplicate permissive
RLS policies (changes who sees what, not how fast), inlining the RLS helper
functions (a security boundary, worth 30 ms), the bulk-update N+1 in
`lib/actions/tasks/bulk.ts` (6 s, but on a mutation path, not a page load), and
the dashboard payload work (a product decision about how many rows the home
page should show, not a refactor).

Stack unchanged: Next.js 16.3.1 App Router, React 19.2, Supabase with RLS as
the authorization boundary, Supabase design system per CLAUDE.md.
