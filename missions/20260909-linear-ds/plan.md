# Mission 20260909-linear-ds — Plan

Migrate pm-app to Linear-reproduced design system. Visual only — no functionality changes.

## Milestones

| M | Features | Gate |
|---|---|---|
| M1 | F001–F003 | Token layer + typography running, app boots dark |
| M2 | F004–F007 | All UI components reskinned |
| M3 | F008–F011 | All workspace surfaces reskinned |
| M4 | F012–F013 | Portal isolated, contrast validated |

## Features

### F001 — Token layer: globals.css + @theme
**Scope:** Replace all `--gg-*` values in `:root` with Linear dark tokens.
Add `--line-row`, `--bg-hover`. Add font-weight tokens to `@theme inline`.
Add `[data-surface="portal"]` block restoring Good Guys 3.0 light values.
Keep all shadcn semantic token names unchanged.
**Files:** `app/globals.css`
**Assertions:** VS-001, VS-002, VS-010

### F002 — Typography: font loader + type scale
**Scope:** Replace `Geist` with `Inter` (axes: opsz) in `app/layout.tsx`.
Add `font-feature-settings` and `font-optical-sizing` to `html` in globals.css.
Replace existing type scale classes in `@layer components` with Linear scale
(text-tiny through title-3 with exact px, lh, tracking, weight values).
**Files:** `app/layout.tsx`, `app/globals.css`
**Assertions:** VS-006, VS-007

### F003 — Layout: panel structure
**Scope:** Add panel wrapper to workspace layout so sidebar is bg-level-0
and content is bg-level-1 panel with 1px border, 8px radius.
**Files:** `app/(workspace)/w/[workspaceSlug]/layout.tsx` (markup wrapper only,
no route/data changes)
**Assertions:** VS-003, VS-004

### F004 — Type codemod: text-sm → text-mini, text-xs → text-micro
**Scope:** Find-and-replace all `text-sm` (592 hits) → `text-mini` and
`text-xs` (345 hits) → `text-micro` across all `.tsx`/`.ts` files.
Also `text-base` → `text-regular`, `text-lg` → `title-1`, `text-2xl` → `title-2`,
`text-3xl`/`text-4xl` → `title-3`, `text-xl` → `title-2`.
**Files:** All `.tsx`/`.ts` in `app/`, `components/`
**Assertions:** VS-011

### F005 — UI components: buttons, badges, inputs (components/ui/)
**Scope:** Restylize button (28px, radius-4, transparent + hover fill),
badge/status-badge (outline pill + color dot), input/select/checkbox/radio
(28-32px, radius-4, focus ring #5e69d1). Class changes only — no prop changes.
**Files:** `components/ui/button.tsx`, `components/ui/badge.tsx`,
`components/ui/input.tsx`, `components/ui/checkbox.tsx`,
`components/ui/radio-group.tsx`, `components/ui/switch.tsx`,
`components/ui/label.tsx`
**Assertions:** VS-013, BI-004

### F006 — UI components: overlays (dropdown, popover, dialog, command, sheet)
**Scope:** All overlay components get bg-level-3 (#191a1b), radius-8,
shadow-medium/high recipe, 1px border-secondary.
**Files:** `components/ui/dropdown-menu.tsx`, `components/ui/popover.tsx`,
`components/ui/hover-card.tsx`, `components/ui/command.tsx`,
`components/ui/select.tsx`, `components/ui/dialog.tsx`,
`components/ui/sheet.tsx`, `components/ui/sonner.tsx`
**Assertions:** VS-005, BI-004

### F007 — UI components: tabs, card, table, misc
**Scope:** tabs → pill style (bg-tertiary, no underline), card → bg-level-2
no shadow, table → Linear aesthetic (40px rows, hairline separator),
separator → 0.5px --line-row, skeleton/avatar/progress/breadcrumb.
**Files:** remaining `components/ui/` files
**Assertions:** VS-005, VS-012, BI-004

### F008 — Status pills: restylize
**Scope:** Restylize `components/portal/status-pill.tsx` and
`components/task/status-badge.tsx` and any other status display components
to outline pill + color dot. resolveClientBucket is UNTOUCHED.
**Files:** status display components only (not status-label.ts)
**Assertions:** VS-008

### F009 — Lists and board: reskin (not redesign)
**Scope:** Apply Linear row aesthetic (40px, 13px, 0.5px hairline,
hover #ffffff0d, mono ID) to existing table/list views. Board cards
get bg-level-2, 1px border, no shadow. Zero structural changes.
**Files:** `app/(workspace)/...list`, `app/(workspace)/...board`,
`components/task/` class changes
**Assertions:** VS-012, VS-013, BI-001, BI-002

### F010 — Remaining workspace surfaces
**Scope:** Chat, docs, calendar, approvals, archive, settings — apply
dark tokens, radius, border, shadow rules. Class changes, no structure.
**Files:** `app/(workspace)/` remaining pages and their components
**Assertions:** VS-001, VS-005

### F011 — Navigation and sidebar reskin
**Scope:** Apply bg-level-0 to sidebar, nav items get hover fill
#ffffff0d, active item bg-level-2, icons #8a8f98, text text-mini.
**Files:** sidebar component, nav components
**Assertions:** VS-003

### F012 — Portal surface isolation
**Scope:** Add `data-surface="portal"` attribute to portal layout wrapper.
Verify all portal components render correctly with Good Guys 3.0 light tokens.
Fix any dark-token bleedthrough into portal.
**Files:** `app/(portal)/layout.tsx`, portal components if needed
**Assertions:** VS-002

### F013 — Contrast audit + cleanup + CLAUDE.md rules
**Scope:** Run contrast checks on all VS-009/CA-001–CA-005 assertions.
Fix any quaternary overuse. Remove all remaining `--gg-*`, `shadow-*` (non-overlay),
`text-sm`, `text-xs`. Add Linear design system rules to CLAUDE.md.
**Files:** Any files with violations, `CLAUDE.md`
**Assertions:** All CA-*, VS-009, VS-010, VS-011
