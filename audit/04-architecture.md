# Phase 4 — Architecture & code quality

Verified by a dedicated read-only review pass; every claim checked at the cited lines.

**Overall answer to "architecture or accumulation":** there *is* an architecture — `lib/{actions,queries,validation}` + domain folders, components never touching DB types, realtime factored into React-free testable modules — but it is enforced by convention only, and in the highest-traffic seams (page-level workspace resolution, action auth boilerplate, date formatting) accumulation has won. A new dev would find where things live within an hour; they would also find three ways to do the same thing.

### [ARCH-001] 26 page components bypass the query layer and copy-paste the workspace-membership check
- Severity: high
- Area: architecture
- Location: app/(workspace)/w/[workspaceSlug]/settings/page.tsx:52-70 and settings/task-types/page.tsx:31-49 (byte-identical blocks); 26 files under `app/` call `.from("workspace_members")` directly; 67 app pages import `lib/supabase/server`
- Evidence: the "resolve workspace by slug → read own role → default `guest`" block is repeated; `lib/queries/workspaces.ts` exports a single function and does not own this query.
- Verified by: grep counts + read of both cited files
- Why it matters: the authorization decision for every workspace route has 26 edit sites. A change to the membership predicate (suspension, deleted_at) that misses one site is a silent privilege bug, not a compile error.
- Fix: `getWorkspaceContext(slug)` in lib/queries/workspaces.ts, `cache()`-wrapped, returning `{workspace, role, user}`; replace all 26 blocks.
- Effort: M
- Confidence: high

### [ARCH-002] Auth boilerplate hand-rolled ~150× despite an existing `withAuthz` used by only 22/58 action files
- Severity: high
- Area: architecture
- Location: lib/actions/authz.ts:155 (the abstraction); lib/actions/checklist.ts:189,339,437,524,607; lib/actions/comments.ts:141,492,772,1059,1379 (representative of 149 raw `auth.getUser()` in actions); lib/auth/current-user.ts imported by only 14 files vs 52 pages calling `getUser()` raw
- Evidence: two parallel conventions for the same job; the safer, cached one lost. Each un-cached `getUser()` is a real Auth round trip per call.
- Why it matters: consistency of the security-critical path, plus measurable latency (the perf mission batched queries but left this).
- Fix: migrate remaining actions onto `withAuthz`; make `getCurrentUser` the only `getUser` call site; enforce with `no-restricted-syntax`.
- Effort: L · Confidence: high

### [ARCH-003] Date/duration formatting reimplemented ~40×, with disagreeing timezone/locale behavior
- Severity: medium
- Area: correctness
- Location: lib/time/format-duration.ts:14 copied verbatim as local `formatMinutes` in components/time/person-daily-bar-chart.tsx:10, app/(workspace)/w/[workspaceSlug]/time/page.tsx:60, time/[userId]/page.tsx:61; local `formatDate` in ≥20 files (components/portal/risk-banner.tsx:25, decision-log.tsx:16, file-list.tsx:17, task-list.tsx:39, approval-card.tsx:55, project-members.tsx:64, …)
- Evidence: the locals disagree — some pin `timeZone:"UTC"`, some don't; some pin `en-GB`, project-members.tsx:64 passes browser-dependent `undefined` locale (hydration-mismatch prone); `formatHours` has three variants (`"1.5"` vs `"1.5h"`).
- Why it matters: the UTC/local split is a real off-by-one-day bug class on due dates, and the same date renders differently per screen.
- Fix: one `lib/format/` module with the timezone contract stated once; delete locals.
- Effort: M · Confidence: high

### [ARCH-004] `getTaskDetail` still pays for comments the UI discarded
- Severity: medium
- Area: performance
- Location: components/task/task-detail-sheet.tsx:550 (prop declared, :525-541 never destructured; :2345 documents Comments tab removal); lib/actions/tasks/queries.ts:482-535,863 (comments + reactions + mention resolution still fetched); passed at components/board/board.tsx:1189, task-list-table.tsx:940, portal task page:86
- Evidence: optional unused prop TypeScript can't flag, paid with real DB work on the hottest interaction (opening a task).
- Fix: drop the prop and the query branch, or reinstate CommentList — decide, don't keep both halves.
- Effort: S · Confidence: high

### [ARCH-005] God files mix domains rather than being deep
- Severity: medium
- Area: maintainability
- Location: lib/queries/portal.ts (1991 LOC, ~20 read domains, internally duplicates its client-bucket map build at :188-195 and :1409-1419); lib/actions/architecture.ts (1972 LOC, 17 actions across pages/sections/components entities); components/task/task-detail-sheet.tsx (2470 LOC, 21 useState, 16 props, composes 6 feature panels)
- Fix: portal.ts → `lib/queries/portal/{projects,phases,badges,team,requests,files,pages,activity}.ts` + shared `lib/portal/status-bucket.ts`; architecture.ts → three files by entity; task-detail-sheet → extract `TaskFieldsForm` (where ~18 of 21 states live) + composition shell.
- Effort: L · Confidence: high

### [ARCH-006] Observability is a console wrapper; Sentry claimed in comments but not wired
- Severity: medium
- Area: maintainability
- Location: lib/observability/logger.ts (43 lines; :16-35 stdout JSON in prod, console in dev; :8 "Future: a Sentry transport"); lib/actions/attachments.ts:289 calls it "Sentry-equivalent"; no @sentry/* in package.json; SENTRY_* vars in .env.example unread
- Why it matters: on Vercel this is stdout only — no alerting, grouping, or release tracking; nobody learns a server action started failing. The comments actively mislead during an incident.
- Fix: wire a real transport at the `emit` seam (the seam is well placed) or delete the equivalence claims and the dead env vars.
- Effort: M · Confidence: high

### [ARCH-007] No rate limiting anywhere, including the three bearer-token extension routes
- Severity: medium
- Area: security
- Location: app/api/extension/{tasks,context,attachments}/route.ts; grep for ratelimit across app/ lib/ → 0 hits; attachments accepts 10 MB uploads (lib/validation/attachments.ts:13) with no per-user cap
- Why it matters: any valid token can loop task creation or storage writes until the Supabase quota/bill is the limit. Internal-team blast radius, but the portal means real clients hold tokens too.
- Fix: per-user token bucket in front of the three handlers + daily upload-bytes cap.
- Effort: M · Confidence: high

### [ARCH-008] Extension route auth+CORS preamble triplicated verbatim (acknowledged in-code)
- Severity: low
- Area: maintainability
- Location: tasks/route.ts:60-128, context/route.ts:55-93, attachments/route.ts:56-102 (attachments:52: "duplicated, not shared")
- Fix: `lib/api/extension-auth.ts` exporting `withExtensionAuth(handler)`.
- Effort: S · Confidence: high

### [ARCH-009] `useState(initialX)` server-state mirroring is inconsistent; some components ignore server refreshes
- Severity: medium
- Area: correctness
- Location: correct resync pattern in components/my-tasks/personal-todo-list.tsx:81, task-type-manager.tsx:271, portal/task-list.tsx:289; missing in components/board/board.tsx:213 (survives only because the realtime hook re-delivers rows), components/project/record-panel.tsx:273,795, components/notifications/notification-panel.tsx:149
- Evidence: 287 `revalidatePath` + 84 `router.refresh()` sites push fresh props these components ignore — they go stale until remount.
- Fix: apply the one render-phase resync convention to all 37 sites, or lift lists to server components.
- Effort: M · Confidence: high

### [ARCH-010] SVG allowed in attachment uploads, served from signed Storage URLs
- Severity: low
- Area: security
- Location: lib/validation/attachments.ts:26 (`image/svg+xml` in allowlist); lib/attachments/upload.ts:266, upload-chat.ts:172 (signed URLs, no download disposition)
- Why it matters: an uploaded SVG executes embedded script on the Storage origin when opened directly — cross-origin from the app so no session theft, but attacker-hosted JS under your project's domain (phishing).
- Fix: drop SVG from the allowlist or force `download:true` on signed-URL creation for that MIME.
- Effort: S · Confidence: high

### [ARCH-011] 185 bespoke `*Result` types instead of one `ActionResult<T>`
- Severity: low
- Area: maintainability
- Location: lib/actions/workspaces.ts:32-67 (ten near-identical aliases); lib/actions/authz.ts:101 already defines the shared failure half
- Why it matters: the convention itself is consistent (good); refining it (adding an error `code`) is currently a 185-declaration change.
- Fix: `type ActionResult<T> = { ok: true; data: T } | AuthzFailure`; keep domain names as aliases.
- Effort: M · Confidence: high

## Dependency-graph summary

Most-imported: lib/supabase/server (164), components/ui/button (140), lib/observability/logger (130), lib/utils (93), lib/auth/permissions (83), lib/supabase/admin (72), lib/queries/portal (60). Coupling sits in infra/UI primitives, not feature-to-feature — healthy. Most outgoing: task-detail-sheet.tsx (52), task-list-table.tsx (29), board.tsx (25), workspace layout (25) — the god files above.

## What is fine

Layering in `components/` is genuinely clean: **zero** components import `database.types` — DB rows are mapped to hand-written domain types in `lib/queries/*`; the only `createClient` imports under components/ are browser clients inside realtime hooks, with channel logic factored into React-free unit-testable modules (lib/board/subscribe-board-realtime.ts, reconcile-realtime-task.ts). Naming is unusually disciplined (158 `getX` vs 3 outliers; kebab-case throughout; `lib/validation/<domain>.ts` mirrors `lib/actions/<domain>.ts` one-for-one). TODO debt is effectively zero (one honest marker at lib/actions/workspaces.ts:1214 — soft-delete not cascading, worth tracking) and there are no commented-out code blocks. Error handling: 736 structured `logger.*` calls vs 12 `console.error`; ~25 route error boundaries all delegating to one `route-error.tsx`. Upload validation re-checks real byte length rather than trusting the client (lib/attachments/upload.ts:112). Exactly one `dangerouslySetInnerHTML` (static theme script), no open redirects (auth callback builds redirects from `requestUrl.origin` + hardcoded paths). Minor nits only: `lib/utils.ts` coexisting with `lib/utils/`, a few loose top-level modules (`lib/task-colors.ts`, `lib/user-color.ts`, `lib/status-note.ts`).
