# Validation Contract — 20260909-linear-ds

**IMMUTABLE once APPROVED.** New requirements get new assertion IDs.
Existing assertions are never edited or deleted.

---

## Visual scope assertions

**VS-001** All workspace internal surfaces render with dark backgrounds
(bg-level-0 to bg-level-3 from Linear token set).

**VS-002** Portal surfaces under `[data-surface="portal"]` render with
light backgrounds (Good Guys 3.0 tokens preserved).

**VS-003** Sidebar (`app/(workspace)/.../layout.tsx`) uses `--color-bg-sidebar`
(`#08090a`) with no visible border between sidebar and content panel.

**VS-004** Content panels have 1px border, 8px radius, and `bg-level-1` background.

**VS-005** No `shadow-*` utility classes appear on cards, buttons, tables,
sidebar, or navigation — only on overlay components (dropdown, popover,
dialog, command, sheet, tooltip).

**VS-006** Inter Variable is loaded with `axes: ["opsz"]` and rendered with
`font-feature-settings: "cv01", "ss03"` and `font-optical-sizing: auto`.

**VS-007** Font weights 510 and 590 are used for medium and semibold
respectively (not 500 and 600).

**VS-008** Status pills remain text-based with a color dot — not icon-only.
`resolveClientBucket` in `components/portal/status-label.ts` is unchanged.

**VS-009** `text-quaternary` (#62666d) is used only on decorative/non-essential
elements (IDs, keyboard hints, empty-state secondary labels) — never on text
the user must read to operate the app.

**VS-010** No `--gg-*` tokens remain in any `.tsx`, `.ts`, or `.css` file
(except inside `[data-surface="portal"]` scope where they are intentional).

**VS-011** No `text-sm` or `text-xs` Tailwind classes remain — replaced by
`text-mini` (13px) and `text-micro` (12px).

**VS-012** Row separators in list/table views use 0.5px `--line-row` (#202122),
not 1px `--border`.

**VS-013** Hover state on interactive rows uses `bg-[#ffffff0d]` fill only
(no background color tokens, no border change).

## Behavioral integrity assertions (inherited — must still pass)

**BI-001** Drag-and-drop on board view moves tasks between columns correctly.

**BI-002** Table column sort, filter, and pagination work unchanged.

**BI-003** All existing behavioral assertions in the active
`missions/20260903-portal/validation-contract.md` continue to pass.

**BI-004** No component's public props signature changes (no added required
props, no removed props, no type changes).

**BI-005** `git diff` contains zero changes to `lib/`, `app/api/`,
`supabase/migrations/`, or any hook/action/query file.

## Contrast assertions

**CA-001** `text-primary` (#f7f8f8) on `bg-level-1` (#0f1011) ≥ 7:1 (AAA).

**CA-002** `text-secondary` on `bg-level-1` ≥ 4.5:1 (AA).

**CA-003** `text-tertiary` (#8a8f98) on `bg-level-1` ≥ 4.5:1 (AA).

**CA-004** All interactive controls (buttons, inputs, links) meet AA contrast.

**CA-005** Status color dots meet AA contrast against their pill background.

## Definition of done

All three must hold simultaneously:

1. Every assertion in this contract passes.
2. `git diff main` contains zero changes to `lib/`, `app/api/`,
   `supabase/migrations/`, or component prop signatures.
3. No `--gg-*` token, `shadow-*` class (outside overlay recipes),
   `text-sm`, or `text-xs` remains.
