# Handoff: F005 — UI components: buttons, badges, inputs (components/ui/)

## Status
COMPLETE

## Assertions covered
This is a [CLARIFIED-AUTO] visual-only design feature with no functional assertions assigned in validation-contract.md. No AS-NNN IDs are mapped to F005.

## Files changed
components/ui/button.tsx
components/ui/badge.tsx
components/ui/input.tsx
components/ui/checkbox.tsx
components/ui/switch.tsx
components/ui/label.tsx

## Commands run
`npx tsc --noEmit -p .` (1, pre-existing failure in tests/unit/docs-markdown-editor-export-import.test.tsx unrelated to this change — verified identical failure present when changes stashed)
`npm run build` (1, same pre-existing test-file typecheck error blocks the build's TS check step; Next.js compile step itself succeeded)
`git stash && npx tsc --noEmit -p . && git stash pop` (used to confirm the typecheck error predates this feature)

## Decisions made
- Removed `monoLabel` (IBM Plex Mono uppercase) styling from button.tsx entirely since the Linear spec calls for `text-mini font-medium` on all variants, not the old Good Guys mono treatment. Variant names were preserved exactly.
- Button `default` size height changed from `h-8` to `h-7` (28px) and padding to `px-3` per spec; `xs`, `sm`, `lg`, and icon sizes left untouched since spec only specifies the base height/radius/padding without mentioning size variants.
- Used `rounded` for button radius (Tailwind's default rounded = 4px per config) — verified via existing `rounded-[4px]` usage elsewhere in the file (checkbox) that 4px is the intended value; used `rounded` shorthand as spec suggested either form was acceptable.
- Badge: removed solid `bg-primary`/`bg-muted`/`bg-destructive` fills across variants and replaced with `bg-transparent` + `border-border` (or `border-destructive/40` for destructive) to match "outline pill" Linear style, since spec said "remove any solid background from default variant" and to keep variant names but restyle classes.
- Ghost/outline hover states use `hover:bg-[#ffffff0d]` (Linear's characteristic translucent white fill) per spec's literal token for button ghost/default variant; applied consistently to badge ghost/outline hovers too since spec's "Linear pill" aesthetic implies the same treatment.
- Switch: kept `data-checked`/`data-unchecked` selectors already present (functionally equivalent to `data-[state=checked]`) since Base UI's Switch primitive exposes `data-checked`/`data-unchecked` attributes, not `data-[state=checked]`; only added `shadow-none` since no shadow classes existed to remove and bg-primary/bg-input state colors were already correct.
- Checkbox: kept existing `data-checked:bg-primary data-checked:border-primary` (Base UI attribute) and additionally added the literal `data-[state=checked]:bg-primary data-[state=checked]:border-primary` classes requested by the spec text for defensive compatibility, though they are inert no-ops given Base UI's actual attribute name.

## Out-of-scope work needed
None identified — file scope was fully covered by the spec's file list.

## Blockers

## Autonomous decisions
AUTONOMOUS_DECISION: This is a [CLARIFIED-AUTO] feature with no clarification file and no assigned validation-contract assertions (visual-only design system change). Applied the Clarified spec's exact class-string guidance verbatim per file, preserving all variant names, prop signatures, and logic untouched, and verified via build compile (Turbopack step succeeded) and diff-of-behavior (no `.tsx` logic touched, only `cva`/`cn` class strings).

## Notes for the next worker
The repo-wide `npx tsc --noEmit` and `npm run build` both fail on a pre-existing, unrelated error in `tests/unit/docs-markdown-editor-export-import.test.tsx` (Blob/tuple type mismatch) that exists on the branch tip before this commit (confirmed via `git stash`). This is not caused by F005 and should be tracked as separate cleanup if a strict CI gate needs a clean `tsc --noEmit`. Next.js's Turbopack compile step itself succeeds, confirming no runtime/JSX errors were introduced by these class-string-only changes.
