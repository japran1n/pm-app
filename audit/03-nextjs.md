# Phase 3 — Next.js

Verified by a dedicated read-only review pass over `app/`, `lib/actions/`, `next.config.ts`, `proxy.ts` (every claim checked at the cited lines).

### [NX-001] No security headers anywhere
- Severity: high
- Area: security
- Location: next.config.ts:1 (no `headers()`); proxy.ts:25 (sets none)
- Evidence: the entire Next config is `agentRules: false` + a Server Action body-size limit. No CSP, no HSTS, no `X-Frame-Options`/`frame-ancestors`, no `X-Content-Type-Options` — from config or middleware.
- Verified by: read both files end to end; confirmed at runtime in phase 5 would require curl -I (headers not in the route sweep)
- Why it matters: a fully-authed app rendering user-authored rich text (tiptap) and external images has both its clickjacking and its XSS blast-radius mitigations missing. This is the single most consequential app-layer gap.
- Fix: add a `headers()` block: `frame-ancestors 'none'` (or X-Frame-Options DENY), HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, then work toward a nonce-based CSP (see NX-002).
- Effort: S for the basic set; M for CSP
- Confidence: high

### [NX-002] Inline theme script will block a strict CSP
- Severity: medium
- Area: security
- Location: app/layout.tsx:33-38
- Evidence: `dangerouslySetInnerHTML` inline `<script>` reading `localStorage.theme` (static, no interpolation — not an XSS itself).
- Why it matters: any future CSP needs `'unsafe-inline'` or a nonce because of this one script; do it as part of NX-001.
- Fix: per-request nonce from proxy.ts, `nonce` attr on the script.
- Effort: S · Confidence: high

### [NX-003] No runtime env validation; bare `process.env.X!` at point of use
- Severity: medium
- Area: correctness
- Location: lib/supabase/server.ts:147, lib/supabase/admin.ts:13, lib/supabase/client.ts:8, app/api/extension/tasks/route.ts:116, app/dev-login/route.ts:30
- Evidence: no `lib/env.ts`; each consumer asserts with `!`. Worse: app/api/extension/tasks/route.ts:59-66 silently omits all CORS headers when `EXTENSION_ID` is unset — the extension just stops working with no error anywhere.
- Verified by: grep + read
- Why it matters: a missing var fails deep inside a request (or silently, in the CORS case) instead of at boot.
- Fix: one zod-parsed `lib/env.ts` (server/client split) imported at module load; make missing `EXTENSION_ID` a boot error or explicit log.
- Effort: M · Confidence: high

### [NX-004] No `not-found.tsx` at any level and no `global-error.tsx`
- Severity: medium
- Area: correctness
- Location: app/ (absent files); app/error.tsx:1 acknowledges the gap in a comment
- Evidence: `find app -name "not-found.tsx"` and `-name "global-error*"` both return nothing. 38 `error.tsx` and 44 `loading.tsx` exist — coverage is otherwise near-complete.
- Why it matters: a bad `[workspaceSlug]`/`[taskKey]` renders Next's default unstyled 404 outside the app shell; if the root layout itself throws there is no fallback at all.
- Fix: add `app/not-found.tsx`, a workspace-segment one, and a minimal `app/global-error.tsx`.
- Effort: S · Confidence: high

### [NX-005] Caching strategy is contradictory: force-dynamic layouts + 287 revalidatePath calls
- Severity: medium
- Area: performance
- Location: app/(workspace)/w/[workspaceSlug]/layout.tsx:99 and app/(portal)/portal/[workspaceSlug]/layout.tsx:48 (`dynamic = "force-dynamic"`); lib/actions/workspaces.ts:433,1389,1595,1774 (`revalidatePath(..., "layout")`, one on `"/"`)
- Evidence: 51 action files call revalidate; with both authed trees force-dynamic, nothing under them is cached, so most `revalidatePath` calls are no-ops paying a coordination cost — and the broad `"layout"`/`"/"` scopes show the calls are aimed by habit, not by cache key.
- Why it matters: repeated team time reasoning about invalidation that does nothing; and if anyone ever removes `force-dynamic`, the over-broad scopes will thrash the cache.
- Fix: decide once — keep force-dynamic and delete most revalidate calls, or drop it and narrow paths to page level.
- Effort: M · Confidence: high

### [NX-006] Heavy libraries eagerly bundled into client paths (xyflow, tiptap)
- Severity: medium
- Area: performance
- Location: components/architecture/architecture-view-toggle.tsx:8 (static `CanvasBoard` → whole @xyflow/react even when canvas view never opened); docs pages app/(workspace)/w/[workspaceSlug]/docs/[docId]/page.tsx:5 and chat composer components/chat/message-composer.tsx (tiptap eager)
- Evidence: only two subtrees are code-split (`components/dashboard/dashboard-content-lazy.tsx:8`, task-sheet's RichTextEditor at components/task/task-detail-sheet.tsx:205); comment-list.tsx:111 uses a deliberate in-effect `import()` — the pattern exists, it's just unevenly applied.
- Fix: `next/dynamic` for CanvasBoard behind the toggle and for the chat/docs editors.
- Effort: M · Confidence: high

### [NX-007] Fetch-on-mount waterfalls in ~29 client components
- Severity: low
- Area: performance
- Location: components/task/activity-feed.tsx:167-180 (loads first page via server action in useEffect); components/portal/request-list.tsx:186-201
- Evidence: first paint shows a spinner for data the server could render; the ~10 `use-*-realtime.ts` hooks matching the grep are legitimate subscriptions and excluded.
- Fix: server-render page 1, keep the effect for pagination/realtime deltas.
- Effort: M · Confidence: high

### [NX-008] Five action modules with no zod validation
- Severity: low
- Area: correctness
- Location: lib/actions/chat-search.ts, invites.ts, onboarding-tour.ts, palette-search.ts, project-visibility.ts
- Evidence: no `lib/validation/` import, no `z.` usage (lib/actions/tasks.ts is a false positive — a re-export barrel whose leaves validate).
- Why it matters: Server Actions are network-addressable; these take unvalidated args to the DB layer. Authz still applies, so impact is malformed-input robustness, not privilege.
- Fix: add schemas matching the existing per-domain convention.
- Effort: S · Confidence: high

## What is fine

Server Actions return a strictly consistent `{ ok: false, error }` union with **no raw DB errors leaking** — zod issues surfaced deliberately, DB failures mapped to a generic constant, and the two places touching `error.message` route through an allowlist (lib/actions/portal-approval.ts:207). The extension route handlers are exemplary (bearer identity, membership re-check via the same helper as actions, zod body, single-origin CORS). Error/loading route coverage is near-complete (38 + 44 files, one shared `route-error.tsx`). No `ignoreBuildErrors`/`ignoreDuringBuilds`. Accessibility is genuinely good: zero `div onClick`, 400 aria-labels, dialogs on @base-ui primitives (focus handled), `next/font` used correctly. All 12 `<img>` uses carry justified eslint-disables (signed short-lived Storage URLs / arbitrary external hosts). No client component imports server-only modules.
