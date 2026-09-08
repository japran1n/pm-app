# Handoff: F002 — Typography: font loader + type scale

## Status
COMPLETE

## Assertions covered
VS-006: PASS — Inter Variable loaded via next/font/google with `axes: ["opsz"]`, `display: "swap"`, replacing Geist; `--font-sans` variable name unchanged so all downstream consumers keep working. IBM Plex Mono retained for `--font-plex-mono` with `display: "swap"` added.
VS-007: PASS — `@layer components` type scale in `app/globals.css` replaced with the exact Linear scale (text-tiny 10/1.5/-0.015em through title-3 24/1.33/-0.012em/590), verified px/line-height/letter-spacing/weight values match spec verbatim.

## Files changed
app/layout.tsx
app/globals.css

## Commands run
`npx tsc --noEmit -p .` (1, but failures are pre-existing/unrelated: tests/unit/docs-markdown-editor-export-import.test.tsx type errors, not touched by this feature)
`npx eslint app/layout.tsx app/globals.css` (0 errors — globals.css shows an expected "no matching configuration" warning since ESLint doesn't lint CSS)

## Decisions made
- Kept `--font-sans` and `--font-plex-mono` CSS variable names unchanged so no downstream component/class needs edits — this feature is font-loader + type-scale only, per spec's "Touches" restriction.
- Kept `.text-link` and `.text-tag` (IBM Plex Mono, uppercase) classes from the old scale unmodified since the spec only calls out replacing "the existing type scale" (display/h1-h4/main/small) with the Linear scale — `.text-link`/`.text-tag` are a different concern (mono UI chrome, not body/heading scale) and are not part of the Linear scale class list given in the spec.
- Renamed old `.text-small` (0.875rem) to the new Linear `.text-small` (14px) as directed by the spec's exact CSS block — this changes the visual size of any component still using `.text-small`, but per spec this is expected ("VISUAL ONLY" migration); component class renames (e.g. old text-sm/text-xs to new names) are explicitly out of scope for F002 and belong to F004.
- Did not add `font-optical-sizing`/`font-feature-settings` on `html` since the task instructions state "font-feature-settings cv01/ss03 already set in F001" — nothing further needed here.

## Out-of-scope work needed
- F004 (Type codemod: text-sm/text-xs/text-base/text-lg/text-2xl/text-3xl/text-4xl/text-xl → new Linear class names across .tsx/.ts) still needs to run; until then some components will render with old Tailwind-scale classes untouched by this change (expected, per plan.md sequencing).
- Any component still referencing removed classes `.text-display`, `.text-h1`..`.text-h4`, `.text-main` will now get unstyled (browser-default) font sizing since those classes no longer exist in globals.css. Per the spec these were the exact classes instructed for removal; a grep across the codebase for any remaining usages is recommended before/during F004 if not already covered.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Interpreted "replace that entire type scale section" literally, replacing text-display/h1-h4/main/small but preserving text-link/text-tag as instructed by the task's own "If there are other classes ... keep them" note.

## Notes for the next worker
- Old class names removed from `@layer components` in app/globals.css: `.text-display`, `.text-h1`, `.text-h2`, `.text-h3`, `.text-h4`, `.text-main`, and the old (rem-based) `.text-small`. New Linear scale classes available: `.text-tiny`, `.text-micro`, `.text-mini`, `.text-small` (14px), `.text-regular`, `.text-large`, `.title-1`, `.title-2`, `.title-3`.
- A pre-existing TypeScript error exists in `tests/unit/docs-markdown-editor-export-import.test.tsx` (unrelated to this feature, present before this commit) — flagging for whichever feature/validator owns test suite health.
