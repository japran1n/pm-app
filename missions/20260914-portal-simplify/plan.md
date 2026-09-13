# Plan — Client portal, simplified + workspace↔portal sync

_Mission: 20260914-portal-simplify · Branch `feat/portal-simplify` (worktree `../pm-app-portal-simplify`, isolated from the audit on `audit/2026-09-13`)._
_Approved preview: https://claude.ai/code/artifact/0d23ff1f-ad30-427b-9a29-641b45863042 (user confirmed 2026-09-14)._

User decisions (defaults accepted with confirmation): Results under Project · "Architecture" labelled "Site map" in the portal · decision owners shown inline on each decision, no separate grid on the main list.

Constraints: `resolveClientBucket` untouched; no DB migrations unless unavoidable (none planned); old portal URLs redirect; team-side screens unchanged except the architecture share control and settings labels. All UI copy in English. Serial workers, one commit per feature.

## M1 — Sync fixes (found by audit, before any redesign)

### F001: Scope portal Files to its project and portal_enabled  [CLARIFIED-AUTO]
`getPortalFiles` (lib/queries/portal.ts ~1627) takes workspace id only; `p/[projectId]/files/page.tsx` shows attachments from every readable project incl. portal-off ones. Add projectId param, filter by that project and `portal_enabled`. Legacy `/portal/<slug>/files` stays a redirect. Tests. **AS-001, AS-002**

### F002: Architecture client query excludes deleted rows  [CLARIFIED-AUTO]
`getArchitectureBoardForClient` (lib/queries/architecture.ts ~232): add `deleted_at is null` for pages/sections; components only for returned pages. **AS-003**

### F003: Share architecture pages with the client from the board  [CLARIFIED-AUTO]
Pages/sections are created `client_visible=false` and the architecture UI has no toggle, so the portal Site map is always empty. Add a "Visible to client" control on page (and section) in `components/architecture/*`, reusing the existing task client-visibility action/pattern (`components/task/client-visibility-toggle.tsx`). Sharing a page offers to share its sections too. Default for new items unchanged. **AS-004, AS-005**

### F004: Team edits refresh the portal  [CLARIFIED-AUTO]
Add `revalidatePath(\`/portal/${slug}/p/${projectId}\`, "layout")` (pattern from lib/actions/scope-documents.ts:125) alongside existing revalidates in: project-site, deliverables, phases, project-budgets, project-records, metrics, portal-settings, architecture, docs, brief, time-entries, tasks/* where they affect client-visible data. One small shared helper allowed. **AS-006**

## M2 — Simplified portal

### F005: One "waiting on you" count  [CLARIFIED-AUTO]
Single server helper returning open client decisions + outstanding client materials (not accepted/waived) for a project; used by nav badge and Home callout so the numbers never disagree. Failed read → no number shown (existing honesty rule). **AS-007**

### F006: "For you" page  [CLARIFIED-AUTO]
New route `p/[projectId]/for-you`: one list of decisions (existing approvals) + materials (existing deliverables), soonest due first, overdue flagged; filter chips All/Decisions/Materials with counts; inline actions reuse existing components/actions (approve / "Ask for changes" / upload / mark sent) — only enabled for the decision owner, with an inline "Only <name> can approve" hint; collapsible "Completed & decision history"; positive empty state. Each section fails independently. **AS-008, AS-009, AS-010, AS-011**

### F007: Messages with requests folded in  [CLARIFIED-AUTO]
Conversation page becomes "Messages": composer gains "This is a request for new work" which files a client request via the existing request action (project fixed); the client's requests show with status (Received / Accepted / Declined + reason) on the Messages page. No change to team-side requests inbox. **AS-012, AS-013**

### F008: Four-item sidebar  [CLARIFIED-AUTO]
`buildPortalNavItems`: Home, For you (badge from F005), Messages, Project (expandable: Pages, Site map, Your site, Scope & decisions, Results, Hours [hourly only], Questionnaire [brief], How we work). Secondary nav removed. Project group auto-expands when on a child route; active states correct. Results and Brief now reachable (audit gaps 3, 4). **AS-014, AS-015, AS-016**

### F009: Old routes redirect  [CLARIFIED-AUTO]
`p/approvals` and `p/your-list` → `p/for-you` (filter preselected), `p/requests` → `p/conversation`. Deep links from emails/notifications/"waiting on you" builders updated to new routes. Preview-as-client works. **AS-017**

### F010: Home callout + wording  [CLARIFIED-AUTO]
Overview labelled Home; top callout "N things are waiting on you" → For you (hidden at 0, notes overdue). Rename client-facing "Request changes" → "Ask for changes". **AS-018, AS-019**

### F011: Team knows where things land  [CLARIFIED-AUTO]
Project settings nav shows the portal name under each tab (Deliverables → "For you", Record → "Scope & decisions", Measurement → "Results", Site → "Your site"); architecture board header notes "Shown to client as Site map". **AS-020**

## Milestones
- After M1: scrutiny-validator + unit/integration tests.
- After M2: scrutiny-validator, then ux-validator on the running portal (both themes, mobile width), full `tsc`, lint, unit tests, `next build`.
