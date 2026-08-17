# Handoff: F002 — shadcn init

## Status
COMPLETE

## Assertions covered
(none — foundation/skeleton feature, per feature spec "Assertion IDs covered")

## Files changed
components.json
components/ui/avatar.tsx
components/ui/badge.tsx
components/ui/button.tsx
components/ui/card.tsx
components/ui/dialog.tsx
components/ui/dropdown-menu.tsx
components/ui/input.tsx
components/ui/label.tsx
components/ui/select.tsx
components/ui/separator.tsx
components/ui/sheet.tsx
components/ui/skeleton.tsx
components/ui/sonner.tsx
components/ui/table.tsx
components/ui/tabs.tsx
components/ui/textarea.tsx
components/ui/tooltip.tsx
lib/utils.ts
app/globals.css (updated by CLI)
next-env.d.ts (updated by CLI/tsc)
package.json (new deps)
package-lock.json (new deps)

## Commands run
`npx shadcn@4.18.0 init -d -y` (0)
`npx shadcn@4.18.0 add button input card dialog sheet dropdown-menu avatar badge tabs table sonner label select textarea skeleton separator tooltip -y` (0)
`npx tsc --noEmit` (0)
`npx eslint .` (0)
`npm run build` (0)

## Decisions made
- Used shadcn CLI `4.18.0` (current `latest` at run time), which has replaced the old `style`/`base-color` flag model (`new-york`/`default` + `slate`/`neutral`/etc.) with a **preset** system (`nova`, `vega`, `maia`, `lyra`, `mira`, `luma`, `sera`, `rhea`, or `custom`). There is no `--style` or `--base-color` flag anymore; `init --help` confirms the only related flags are `--preset` and `--css-variables`/`--no-css-variables`.
- Ran `npx shadcn@4.18.0 init -d -y` (`-d`/`--defaults` = `--template=next --preset=base-nova`). Resulting `components.json` has `"style": "base-nova"` and `"baseColor": "neutral"` — this satisfies the spec's "slate or neutral base color" instruction (neutral was selected automatically by the default preset) even though the exact "new-york style" name no longer exists in the current CLI. Documenting per tech-decisions.md's version-freshness rule: the CLI's own `init --help` and preset picker are the source of truth over the (now stale) style/base-color naming in the feature spec.
- Icon library resolved to `lucide` (`"iconLibrary": "lucide"` in `components.json`), matching tech-decisions.md's `lucide-react` choice — no extra icon package installed beyond what shadcn init pulled in (`lucide-react` is now pinned as a direct dependency).
- Added all 17 requested components in a single `shadcn add` invocation: button, input, card, dialog, sheet, dropdown-menu, avatar, badge, tabs, table, sonner, label, select, textarea, skeleton, separator, tooltip (spec listed the first 11; the task instructions given to me added label, select, textarea, skeleton, separator, tooltip — installed all 17 as instructed).
- `button.tsx` was reported "skipped (already exists)" on the `add` step since `init` itself creates it — not an error, no duplicate/conflicting file was written.
- Did not hand-edit any generated file under `components/ui/*`, `components.json`, or the CLI-managed portions of `app/globals.css` — all committed as generated.

## Out-of-scope work needed
- `tooltip` component's install output recommends wrapping the app in `<TooltipProvider>` in `app/layout.tsx`, and `sonner`'s typical usage requires mounting `<Toaster />` somewhere in the tree (e.g. root layout). Both are `app/layout.tsx` edits, which is outside this feature's scope (`components/ui/*`, tailwind config, `app/globals.css` only, per the feature spec's "Files (approximate)" and the Clarified implementation's single-config-change pattern). A future feature that first renders real UI (e.g. F005 per F001's handoff) should add `<TooltipProvider>` and `<Toaster />` to `app/layout.tsx` when it builds actual page content.
- No other out-of-scope items noted.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Selected shadcn CLI's `base-nova` preset (via `-d`/`--defaults`) since the CLI's `style`/`base-color` flags referenced in tech-decisions.md and the feature spec no longer exist in the current `shadcn@4.18.0`. `base-nova` uses the `neutral` base color, which satisfies the spec's "slate or neutral" instruction, and Lucide icons, matching tech-decisions.md's `lucide-react` choice. Recorded here per the version-freshness rule (CLI's actual `--help` output taken as source of truth over spec wording written before this CLI version).
AUTONOMOUS_DECISION: Did not touch `app/layout.tsx` to add `TooltipProvider`/`Toaster` despite the CLI's on-screen recommendation, since that file is outside this feature's declared scope — flagged in "Out-of-scope work needed" instead of expanding scope silently.

## Notes for the next worker
- `components.json`: `"style": "base-nova"`, `"baseColor": "neutral"`, `"iconLibrary": "lucide"`, `"tailwind": { "css": "app/globals.css", "cssVariables": true }`, aliases `@/components`, `@/components/ui`, `@/lib`, `@/hooks`.
- `app/globals.css` now imports `tailwindcss`, `tw-animate-css`, and `shadcn/tailwind.css`, plus a `@theme inline` block mapping shadcn's CSS variables (background, foreground, primary, card, popover, sidebar, chart-1..5, radius scale, etc.) — no separate `tailwind.config.*` file exists or is needed (Tailwind v4 CSS-first config, consistent with F001's setup).
- New dependencies pulled in by shadcn init/add: `@base-ui/react`, `class-variance-authority`, `clsx`, `lucide-react`, `next-themes`, `shadcn` (CLI as a dependency), `sonner`, `tailwind-merge`, `tw-animate-css`.
- `lib/utils.ts` was created by `init` (the standard `cn()` helper) — first file under `lib/`.
- Ran `npm run build` (not just `tsc`/`eslint`) as extra verification beyond the spec's minimum, since a shadcn init touches `app/globals.css` and adds a font-loading path (`Geist`/`Geist Mono` via `next/font/google`, unchanged from F001) that only a full build fully exercises; all three (`tsc --noEmit`, `eslint .`, `npm run build`) pass with exit code 0.
