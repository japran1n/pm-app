# Validation Contract — 20260910-supabase-ds

**IMMUTABLE once APPROVED.** New requirements get new assertion IDs.
Existing assertions are never edited or deleted.

Assertion prefix `SD-` is new to this mission and does not collide with any
prior mission's `VS-`/`AS-` namespace.

---

## Supersession record

Mission `20260909-linear-ds` reached COMPLETE with all 13 of its assertions
GREEN. Its contract remains immutable and its file is not edited. As of this
mission, the following of its assertions are **retired by supersession** —
they described the Linear reproduction and are replaced by the `SD-`
assertions named beside them. They are not "failed"; they no longer describe
the intended system.

| Retired | Was | Superseded by |
|---|---|---|
| VS-001 | Linear dark bg-level palette | SD-001, SD-002 |
| VS-004 | panel 1px / 8px / bg-level-1 | SD-013 |
| VS-005 | no `shadow-*` on cards | SD-014 |
| VS-006 | Inter with `axes: ["opsz"]` | SD-006 |
| VS-007 | weights 510 / 590 | SD-007 |
| VS-008 | status pill = text + colour dot | SD-015 |
| VS-009 | `text-quaternary` usage rule | SD-005 |
| VS-011 | no `text-sm` / `text-xs` | SD-009 |
| VS-012 | 0.5px `--line-row` separators | SD-016 |
| VS-013 | row hover = `bg-[#ffffff0d]` | SD-017 |

VS-002, VS-003 and VS-010 are **carried forward in spirit** and restated as
SD-003, SD-012 and SD-004 respectively.

---

## Token layer

**SD-001** `app/globals.css` contains Supabase's token engine copied from
`packages/ui/build/css/source/semantic.css`, including the derived
`--background`, `--foreground`, `--card`, `--popover`, `--secondary`,
`--muted`, `--accent`, `--border`, `--input` and `--ring` definitions in
OKLCH. No hand-written hex value defines any of them.

**SD-002** The six theme knobs `--hue`, `--chroma`, `--surface`,
`--foreground-lightness`, `--contrast` and `--elevation-step` are present and
carry Supabase's published values: dark `159 / 0.005 / 0.19 / 0.95 / 0.5 /
0.025`, light `159 / 0 / 0.995 / 0.1 / 0.53 / 0.024` with
`--surface-hue: 34`.

**SD-003** Both themes are defined. The dark theme applies under
`.dark` / `[data-theme="dark"]` and the light theme under
`.light` / `[data-theme="light"]`, matching Supabase's own selectors.

**SD-004** No `--gg-*` token and no `--line-row`, `--bg-hover` or
`--text-quaternary` declaration remains in any `.css`, `.ts` or `.tsx` file.

**SD-005** Every colour a user must read to operate the app meets WCAG AA
against the surface it sits on, in both themes. `--tertiary-foreground` is
used only on decorative or non-essential text.

---

## Typography

**SD-006** Inter is loaded without the `opsz` axis and exposed as
`--font-inter`; Source Code Pro is loaded and exposed as
`--font-source-code-pro`. IBM Plex Mono is no longer loaded anywhere.

**SD-007** `--font-weight-normal` is 450. Medium is 500 and semibold is 600.
No `510` or `590` weight value remains in any file.

**SD-008** The Tailwind type scale carries Supabase's Inter-tuned values:
`--text-sm: 0.8125rem`, `--text-base: 0.9375rem`, `--text-lg: 1rem`,
`--text-xl: 1.125rem`, `--text-2xl: 1.375rem`.

**SD-009** No `.text-tiny`, `.text-micro`, `.text-mini`, `.text-small`,
`.text-regular`, `.text-large`, `.title-1`, `.title-2`, `.title-3`,
`.text-link` or `.text-tag` utility is defined in `app/globals.css` or used in
any `.tsx` file.

**SD-010** All machine-generated data renders in the mono face: dates,
timestamps, relative times, email addresses, identifiers, task keys, counts,
durations, currency amounts, file sizes and percentages.

**SD-011** Human-written content — task titles, descriptions, comments,
document bodies, chat messages, names — renders in the sans face.

---

## Structure and component anatomy

**SD-012** The workspace sidebar renders on `--background` with a
`--border` right edge, and its items are ghost/secondary buttons at
`text-sm`, matching Supabase's `supabase-manager/index.tsx` navigation.

**SD-013** Content panels use `--card` with a 1px `--border` and 8px radius;
overlays (dialog, popover, dropdown, sheet, command, tooltip) use `--popover`.

**SD-014** Cards carry `shadow-xs`. No other shadow utility appears on any
non-overlay surface.

**SD-015** Status and role pills use Supabase's Badge anatomy: pill radius,
uppercase, 9px, `tracking-[0.07em]`, weight 500, `px-[5.5px] py-[3px]`, a 1px
border, and a 10% tint of the semantic colour as fill. No colour dot.

**SD-016** Row separators in list and table views are 1px `--border`.

**SD-017** Hover on interactive rows and controls is expressed as a border
lift (`--border-control-hover`) or `bg-muted/50`. No `#ffffff0d` or
`#ffffff1a` literal remains in any file.

**SD-018** Buttons follow Supabase's anatomy: `rounded-md`, a border on every
variant including primary, `duration-200` transitions, and
`motion-safe:active:scale-[0.97]`. Sizes match `SIZE.height` — tiny 26px,
small 34px, medium 38px, large 42px.

**SD-019** Page headers use `p-6 pt-4 lg:p-8 lg:pt-8` with a
`text-base lg:text-xl font-semibold` title; sections use
`px-6 lg:px-12`; table edge cells use `first:pl-6 lg:first:pl-8` and
`last:pr-6 lg:last:pr-8`.

---

## Theme switching (new functionality)

**SD-020** A theme switch is reachable from the workspace UI and from the
client portal UI, and offers light, dark and system.

**SD-021** The chosen theme persists across reloads and is applied before
first paint — no flash of the wrong theme.

**SD-022** With no explicit choice made, the app follows the operating
system's `prefers-color-scheme`.

**SD-023** Every screen in both the workspace and the portal is legible and
correctly themed in both light and dark. No screen hardcodes a colour that
only works in one theme.

**SD-024** The theme choice is per viewer and never leaks between users or
workspaces.

---

## Portal unification

**SD-025** `[data-surface="portal"]` no longer scopes a separate palette.
Portal and workspace read the same token set and differ only in layout and
information density.

**SD-026** No Good Guys 3.0 value (`#f7f8fa`, `#3670e1`, the `--gg-gray-*`
ramp) remains anywhere in the codebase.

---

## Behaviour preservation

**SD-027** `resolveClientBucket` in `components/portal/status-label.ts` is
byte-identical to its state at the start of this mission.

**SD-028** The full test suite passes. No test is deleted or weakened to
accommodate a styling change; a test that asserts a retired class is updated
to assert the replacement, not removed.

**SD-029** Every one of the 67 routes renders without a runtime or hydration
error in both themes.

**SD-030** No user-facing copy, flow, keyboard shortcut, or permission
behaviour changes, with the sole exception of the theme switch added by
SD-020.
