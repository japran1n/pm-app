# Standalone Sitemap Tool — handoff

Started 2026-09-20. Continue from here in a new session.

## Goal
An octopus.do-style sitemap builder that lives under Tools, is NOT tied to
any project, and can be shared with anyone via a public link (view-only).
Used for sending proposals to clients without detouring through octopus.do.

## Scope decisions (from the user, final)
- NO comments on shared links
- NO password on shared links
- NO expiry — token is revocable only
- NO "promote to project" path

## Key finding
Architecture has no tables of its own. A page IS a `tasks` row with
`page_slug` set and `parent_task_id is null`; a section is that task's
subtask; components are `page_components`. See the header comment of
lib/queries/architecture.ts. This is inseparable from projects, hence
new tables for the standalone tool.

Reusable as-is: lib/architecture/page-tree.ts (hierarchy derived from slug
path), components/architecture/canvas-board.tsx (React Flow canvas),
lib/architecture/sitemap-io.ts (JSON import/export). All operate on the
`BoardPage[]` / `ArchitectureBoard` shape, so the new backend adapts TO
that shape rather than changing the UI.

Blocker that Phase 0 removes: 19 leaf components under
components/architecture/ import server actions directly from
"@/lib/actions/architecture".

## Phases
- [~] Phase 0 — SitemapActionsContext provider + `readOnly` flag; leaf
      components consume context instead of importing actions. Behaviour
      of the existing Architecture tab unchanged. Optional capabilities
      (estimates, node-meta, client-visibility) simply do not render when
      the backend lacks them.
- [~] Phase 1 — tables `sitemaps`, `sitemap_pages`, `sitemap_sections`,
      `sitemap_components`, `sitemap_shares` (token, revoked_at only).
      RLS: workspace members. Public share route does NOT use anon RLS —
      it resolves the token server-side via the admin client.
      lib/queries/sitemaps.ts returns the existing `ArchitectureBoard`
      shape. lib/actions/sitemaps.ts for mutations.
- [ ] Phase 2 — /w/[slug]/tools/sitemap (instance list: new, duplicate,
      rename, archive) and /w/[slug]/tools/sitemap/[id] (canvas). Card on
      the Tools index page.
- [ ] Phase 3 — route group `(share)` → /s/[token]. Outside the
      (workspace) and (portal) segments so it never inherits their auth
      guards. Read-only canvas, minimal chrome, noindex. Share dialog with
      generate/copy/revoke.
- [ ] Phase 4 — JSON/CSV export via lib/architecture/sitemap-io.ts.
      PNG/PDF deferred.

## Environment notes
Credentials are on disk, not in the Claude account: .env / .env.local
(gitignored) and .mcp.json / ~/.claude.json. Switching Claude accounts on
the same Mac needs nothing but re-authorizing the Supabase claude.ai
connector. A different machine needs .env copied over by hand.

## Repo rules
CLAUDE.md governs: the orchestrator never edits project code (spawn
workers), Supabase design system tokens, and the immutable validation
contract at missions/20260910-supabase-ds/validation-contract.md.
