# Audit — workspace Architecture vs portal Site map parity (read-only, 2026-09-15)

## Prior mission context

`missions/20260914-portal-simplify/plan.md` + `validation-contract.md`
(F002/F003) already fixed sync/visibility plumbing:
- **F002** (AS-003): `getArchitectureBoardForClient` excludes soft-deleted
  pages/sections (`lib/queries/architecture.ts:242-248`).
- **F003** (AS-004/AS-005): client-visibility toggle on pages/sections
  (`components/architecture/page-client-visibility-toggle.tsx`,
  `section-client-visibility-toggle.tsx`) with a share-cascade dialog.
- Renamed "Architecture" → "Site map" in client-facing nav only; underlying
  route/component names (`app/(portal)/.../architecture/page.tsx`,
  `ClientArchitectureBoard`) were not renamed.

Neither touched what the portal *renders* — this audit is about that gap.

## A. Workspace Architecture board — capabilities

Route: `app/(workspace)/w/[workspaceSlug]/projects/[projectId]/architecture/page.tsx`
→ `getArchitectureBoard` (`lib/queries/architecture.ts:185-219`, unfiltered)
→ `ArchitectureViewToggle`.

1. **Two view modes**: "Column" board (`board.tsx`) and "Canvas" tree/graph
   (`canvas-board.tsx`), canvas is the default
   (`architecture-view-toggle.tsx:45`).
2. **Nested page hierarchy** from slug path segments, synthetic "folder"
   nodes for path segments without their own page —
   `lib/architecture/page-tree.ts:1-80` (`buildPageTree`), rendered by
   `canvas-board.tsx:78-201` (`SitemapNode`), pan/zoom/minimap via
   `@xyflow/react` (`canvas-board.tsx:338-421`), collapse/expand
   (`canvas-board.tsx:165-198`), "Create page here" on empty folders
   (`canvas-board.tsx:126-133`, team-only).
3. **Flat column board** — one column per page, drag-reorder sections
   within/across columns and pages, shared `DndContext`, a11y announcements
   — `components/architecture/board.tsx:56-397`.
4. **Page CRUD**: create/rename/delete/reorder/kind-select
   (Static/CMS/Template/Utility)/bulk import — `lib/actions/architecture/pages.ts`.
5. **Section CRUD**: create/rename/delete/reorder within+across pages —
   `lib/actions/architecture/sections.ts`.
6. **Components concept**: create from a section or from scratch, link/unlink
   via searchable picker, rename propagates to instances, delete leaves
   instances with `component_id = null` — `lib/actions/architecture/components.ts`.
7. **Components side panel**: every project component with live instance
   counts (incl. zero), rename/delete in place, "detail" view showing every
   page it appears on with click-to-scroll navigation —
   `components/architecture/component-panel.tsx:235-370`.
8. **CSS-only hover-linking**: hovering one instance highlights every other
   instance across the whole board/canvas with no React re-renders —
   `lib/architecture/use-component-hover.ts`, wired at `board.tsx:110`,
   `canvas-board.tsx:329`, styling via `data-component`/`data-hover-component`
   in `section-card.tsx:159-174`.
9. **Visual kind coding**: CMS pages/sections tinted lilac, component-linked
   sections tinted green, folders amber-dashed —
   `section-card.tsx:157-174`, `canvas-board.tsx:104-110`.
10. **Client-visibility toggles** (F003) — per-page/section share controls.
11. **Import/Export** (team-only): Sitemap XML/CSV/Markdown/JSON export +
    import (auto-synthesizes missing ancestor folders) —
    `components/architecture/sitemap-io-dialog.tsx`,
    `lib/architecture/sitemap-io.ts`, action `importPages`
    (`lib/actions/architecture/pages.ts:832`).
12. Pages/sections are literally `tasks`/subtasks — edits show up in
    List/Board task views too (`lib/queries/architecture.ts:1-26`).
13. Team hint: "Shared pages appear to the client under Site map."
    (`architecture-view-toggle.tsx:63-65`).

Not present even on the workspace side (so NOT a portal-specific gap — don't
build these as "parity"): no comments on a page/section, no page/section
status or progress indicator on the board itself, no board-wide search/filter,
no diagrams/wireframes (explicitly out of scope per
`missions/drafts/architecture-sitemap.md` §8.7).

## B. Portal Site map — capabilities today

Route: `app/(portal)/portal/[workspaceSlug]/p/[projectId]/architecture/page.tsx:1-45`
→ `getArchitectureBoardForClient` (`lib/queries/architecture.ts:237-276`,
filtered by `client_visible = true` + `deleted_at is null`) →
`ClientArchitectureBoard`.

Renders (`components/architecture/client-board.tsx:16-32`,
`client-page-column.tsx:14-51`):
- One flat, non-nested column per client-visible, non-deleted page,
  horizontally scrollable — no folder/tree structure.
- Page title, description, `PageKindBadge` (same as workspace).
- Each client-visible section as a plain card: title + linked component's
  name as secondary text — no color coding.
- Empty state when zero shared pages.
- **No interactions beyond scrolling** — component explicitly documents
  every editing affordance removed (`client-page-column.tsx:4-13`).

`components` (full `BoardComponent[]` with instance counts) is fetched and
passed in but explicitly discarded — `client-board.tsx:23`
(`void components;`). No Components panel, no instance counts, no
"appears on" list, no hover-linking client-side.

Separate, unrelated portal view "Pages"
(`app/(portal)/.../pages/page.tsx`, `components/portal/pages-table.tsx`)
already gives status/progress per page (`waiting/progress/blocked/done`),
filter, assignee avatar, updated date, page links — but is completely
disconnected from Site map (no shared component, no cross-links).

## C. Gap table (what to build)

| Capability | Workspace | Portal today | Build for portal? |
|---|---|---|---|
| Nested/hierarchical page tree (canvas, folders) | Yes | No (flat only) | **Yes — the single biggest gap.** Read-only canvas (no drag), reuse `buildPageTree`. |
| Page kind badge | Yes | Yes | Already parity — no change needed. |
| Section↔component link display | Yes | Yes (plain text) | Already parity for the text itself. |
| CMS/component color coding on cards | Yes | No | **Yes, cheap** — purely visual, reuse `section-card.tsx`'s color logic. |
| Components panel (list + instance counts + "appears on") | Yes | No — data fetched then discarded | **Yes** — trimmed read-only version of `component-panel.tsx`. Must fix the AS-6 query-scoping gap first (see D.1). |
| Hover-linking of shared component instances | Yes (CSS-only) | No | **Yes, cheap** — reuse `use-component-hover.ts` as-is. |
| Drag-reorder / create / rename / delete | Yes | No | **No — stays team-only, portal remains read-only.** |
| Client-visibility toggle | Yes (team sets it) | N/A | Correct as-is, don't change. |
| Import/Export | Yes | No | Out of scope for this pass (low priority, separate concern). |
| Status/progress per page/section on the board itself | No (lives only in the separate "Pages" table) | No | **Out of scope** — doesn't exist on the workspace board either; would be new scope, not parity restoration. Don't build. |
| Search/filter across pages/sections | No (neither view) | No | Out of scope — not a portal-specific regression. |
| Comments/decisions tied to a page/section | No (dead feature everywhere) | No | Out of scope — nothing to port. |
| Page links (Figma/staging/live) inline on the Site map card | Editable in task detail | Only on the separate "Pages" table | Nice-to-have, not required by this pass — skip unless trivial. |

## D. Bugs / things to fix as part of the same pass

1. **`getArchitectureBoardForClient`'s components query is not
   visibility-scoped** (`lib/queries/architecture.ts:249-252`): selects
   every `page_components` row for the project, identical to the unfiltered
   team-side query. Harmless today only because `client-board.tsx:23`
   discards the prop. **This becomes a real data leak the moment the
   Components panel (above) is built** — an internal-only component used
   solely on hidden pages must not be named/counted for the client. Fix:
   scope the query to components referenced by at least one *returned*
   (already client-visible-filtered) section, not "every component in the
   project." This is AS-6 and must land before/with the Components panel,
   not after.
2. Route/component names still say "architecture" throughout the portal
   despite the client-facing rename to "Site map" — cosmetic, optional
   cleanup, not required by the validation contract.
3. Workspace's own default view is "canvas" (the tree), while the portal
   only ever had the flatter "column" equivalent — i.e. clients see the
   weaker of the two views the team itself prefers. This is the direct
   product-owner complaint; F2/AS-7 addresses it.
