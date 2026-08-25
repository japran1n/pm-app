# Handoff: F269 — contrast and colour-independence audit

## Status
COMPLETE

## Assertions covered
AS-525: PASS — every new status/priority/indicator surface enumerated below already pairs colour with an icon or text (mostly established by earlier features, F157/F167/F179/F150/F154); the one gap found (F219's colour picker being a free choice) was confirmed to already be a curated palette, not free input, and is now further locked down by an explicit test.
AS-526: PASS — computed actual WCAG contrast ratios for every fixed-hex swatch this mission (M10+) added, in both themes. Found and fixed 3 real failures: `PRIORITY_COLORS.backlog`/`COLUMN_COLOR_PALETTE`'s "Slate (dark)" entry (2.18:1 vs required 3:1 on the dark card), the project-nav dot palette's -500 shades (as low as 2.08:1 on the light sidebar), and the "Over estimate" badge text/fill (3.19:1 text vs required 4.5:1, 1.95:1 fill vs required 3:1, both on light theme). All other audited surfaces already passed.

## Files changed
lib/task-colors.ts
lib/board/column-colors.ts
components/nav/project-nav-list.tsx
components/task/task-card.tsx
components/task/time-tracking.tsx
tests/integration/f219-status-management.test.ts
tests/unit/task-colors-contrast.test.ts
tests/unit/column-colors-contrast.test.ts (new)
tests/unit/project-nav-dot-contrast.test.ts (new)
tests/unit/task-card-badge-text-contrast.test.ts (new)

## Commands run
`npx vitest run tests/unit` (0) — 167 files / 1305 tests, all green (1 pre-existing unrelated unhandled-rejection warning from `tests/unit/user-avatar.test.tsx`'s `cookies()`-outside-request-scope noise in `comment-list.tsx`'s mention fetch effect — not caused by this feature, no assertion in that file failed)
`npx tsc --noEmit` (0) — 0 errors
`npx eslint .` (0) — 0 errors, 6 pre-existing warnings (unrelated files: `lib/queries/search.ts`, `tests/unit/invite-member-pagination.test.ts`, `tests/unit/palette-actions-recents.test.tsx`)
`npx next build` (0) — compiled successfully, all routes generated

## Decisions made
- Enumerated every colour-only indicator this mission added (per the spec's list) and traced each to its rendering component:
  - **Blocked-task indicator** (task-card.tsx, F157/AS-283): compliant — `Ban` icon + "Blocked" text, muted (not colour-coded) treatment.
  - **Recurring-task indicator** (task-card.tsx, F179/AS-317): compliant — `Repeat` icon + plain-language rule summary text.
  - **Over-estimate indicator** (task-card.tsx + time-tracking.tsx, F167/AS-301): compliant on icon+text (already had `TriangleAlert` + "Over estimate" text) but its COLOUR failed AS-526 contrast — fixed (see below).
  - **Subtask/checklist completion count** (task-card.tsx, F150/F154, AS-275/AS-272/AS-273): compliant — `ListTree` icon + count text for subtasks; percent text + `aria-label` breakdown for completion (never colour-only, confirmed by the file's own AS-525 doc comment).
  - **Swimlane headers** (components/board/swimlane.tsx, F224): compliant — plain text label + numeric count badge, no colour coding at all.
  - **Custom project-status chips / board column colour** (board-column.tsx, F221/F222): compliant on AS-525 — colour dot is always paired with the column's text label (`resolvedLabel`) right next to it, never colour alone.
  - **Priority badges** (task-card.tsx, F073/F087): compliant — colour dot + `PRIORITY_LABELS` text inside the badge, never colour alone.
  - **User-colour avatars** (lib/user-color.ts, F122): compliant on AS-525 (initials text rendered on the swatch, not a bare colour swatch) and AS-526 (its own doc comment/test already verify all 8 pairs clear 4.5:1, and since bg+fg are both fixed together they don't depend on the app's own theme tokens).
  - **Favourites star** (components/project-favorite-button.tsx, F263): compliant — filled vs. outline star SHAPE changes (not colour alone), plus `aria-pressed`/`aria-label` text.
  - **Project colour dots** (components/nav/project-nav-list.tsx, F262): the dot itself is decorative (project identity is always carried by the adjacent key/name text, so AS-525 doesn't strictly apply), but the spec named it explicitly for the AS-526 audit — several -500 shades failed 3:1 on the light sidebar; fixed (see below).
- **F219's status-colour picker** (lib/board/column-colors.ts + components/project/status-manager.tsx): confirmed it is already a curated `<Select>` dropdown over `COLUMN_COLOR_PALETTE`, not a free colour input — the design constraint the clarification called for. Server-side `updateColumn`/`addColumn` independently re-validate via `isApprovedColumnColor` (lib/validation/statuses.ts), so a direct API call can't bypass the picker's offered set either. One palette entry ("Slate (dark)", #475569) failed the dark-theme half of that constraint — fixed by swapping to zinc-500 (#71717a), which clears 3:1 on both light and dark. Added `tests/unit/column-colors-contrast.test.ts` to lock the palette's contrast AND its "only-approved-values" behaviour going forward.
- **PRIORITY_COLORS.backlog** (lib/task-colors.ts, shared with the "none" priority's neighbour value) had the same slate-600 failure on dark — swapped to zinc-500 (#71717a) to match the column palette's fix (keeps the two "neutral" swatches visually consistent app-wide). Extended `tests/unit/task-colors-contrast.test.ts` with a new dark-theme describe block (`test_AS_526_task_colors_meet_wcag_aa_contrast_on_dark_theme`) rather than replacing the existing light-theme test, since AS-154 (light) and AS-526 (both themes) are separate assertions that must both stay green.
- **Project-nav dot palette** (`DOT_COLORS` in project-nav-list.tsx): swapped every -500 shade to its -600 counterpart (rose/amber/emerald/sky/pink/teal/orange), except violet-500→violet-600 which still failed the DARK sidebar (2.89:1) — used purple-600 instead, the nearest hue that clears 3:1 on both. New `tests/unit/project-nav-dot-contrast.test.ts` pins the fix (hardcodes the resolved hex per class, same convention `task-colors-contrast.test.ts` already established, since Tailwind class names aren't computable at test time without a browser).
- **"Over estimate" badge** (task-card.tsx + time-tracking.tsx, duplicated by design — see F167's own doc comments) used `text-amber-600` for its TEXT, which is normal-size (`text-xs`, not bold/large), so the applicable threshold is 4.5:1, not 3:1 — it measured only 3.19:1 on the light card. Swapped to `text-amber-700` (5.02:1); the dark variant (`dark:text-amber-500`, 7.67:1) was already fine and is unchanged. The progress-bar FILL underneath (time-tracking.tsx) is a non-text UI component (3:1 threshold) against `bg-muted`, which swings from near-white (light) to mid-grey (dark) — one fixed hex (`bg-amber-500`, 1.95:1 on the light track) couldn't clear both, so it's now theme-conditional (`bg-amber-700 dark:bg-amber-400`, 4.57:1 / 6.21:1). New `tests/unit/task-card-badge-text-contrast.test.ts` pins both fixes plus a regression guard proving the OLD values would have failed.
- Updated `tests/integration/f219-status-management.test.ts`'s two literal `color: "#475569"` fixture values to `"#71717a"` — the underlying approved-palette behaviour genuinely changed (the old value is no longer in `COLUMN_COLOR_PALETTE`/`isApprovedColumnColor`), so those specific action calls would otherwise now be rejected by the picker's own server-side validation for reasons unrelated to the tests' actual assertions (RLS/permission checks on rename). Not a loosened assertion — the tests still assert the same permission-denial behaviour, just with a still-valid colour input.
- Measured `app/globals.css`'s core theme tokens (background/foreground/card/muted-foreground/destructive/sidebar, light and dark) via the WCAG relative-luminance formula (oklch converted to sRGB): all clear their respective AA thresholds already (e.g. `--muted-foreground` 4.83:1 light / 6.94:1 dark against `--background`/`--card`; `--destructive` 4.77:1 light / 6.21:1 dark) — no change needed to `app/globals.css` itself.
- Reused existing shared sources rather than inventing new ones: fixed the ONE shared `lib/task-colors.ts`/`lib/board/column-colors.ts` value each, rather than patching every call site; the over-estimate colour is intentionally duplicated between task-card.tsx and time-tracking.tsx (pre-existing F167 design, not introduced here) so both copies were fixed identically.

## Out-of-scope work needed
- None found requiring a new feature — every gap discovered was fixable within this feature's named file scope (lib/task-colors.ts, lib/board/column-colors.ts, components/**, app/globals.css's scope was read but needed no change).
- Not audited (out of this mission's M10+ "new surfaces" scope per the spec, and not named in its Files list): dashboard chart colours (status-pie-chart.tsx) reuse the same now-fixed `STATUS_COLORS`/`PRIORITY_COLORS` constants, so they inherit the fix automatically — no separate check needed there.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Where a single fixed hex could not clear 3:1/4.5:1 against BOTH the light and dark theme backgrounds it's rendered on (project-nav dots, the "Over estimate" fill bar), used Tailwind's existing `dark:` variant classes (already this codebase's established pattern, e.g. the badge text this file already used `text-amber-600 dark:text-amber-500`) rather than inventing a new custom hex or a new colour-token system — the "simpler option, no new dependency, no second source of truth" resolution from the clarification's Round B answer.
AUTONOMOUS_DECISION: Where a single shared fixed-hex constant (not theme-conditional) needed one value to satisfy both themes at once (PRIORITY_COLORS.backlog, COLUMN_COLOR_PALETTE's "Slate (dark)" entry), picked zinc-500 (#71717a) for both — a value in the same "neutral/no-emphasis" hue family, keeping the two swatches visually consistent with each other, rather than diverging them arbitrarily.

## Notes for next worker
- The full palette/contrast math used throughout this audit is plain WCAG relative-luminance arithmetic (no library) — see the new test files for the reusable `relativeLuminance`/`contrastRatio` helpers (same shape as the pre-existing `tests/unit/task-colors-contrast.test.ts`, kept consistent rather than centralizing into a shared test util, matching that file's own existing "hardcode the value under test" convention).
- `oklch()` theme token values in `app/globals.css` were converted to sRGB hex via the standard OKLab matrix (Björn Ottosson's published inverse transform) to get concrete RGB triples for contrast math; approximate hex values used: light `--background`/`--card` = `#ffffff`, light `--sidebar` ≈ `#fbfbfb`, dark `--card`/`--sidebar` ≈ `#1f1f1f` (rendering-engine `getComputedStyle` would give the exact browser-rounded value but the OKLab conversion is accurate to within a couple of least-significant-bits, well inside the margin needed to clear or fail a 3:1/4.5:1 threshold in every case checked here).
- No MCP tools used — this is a pure static-analysis + code-fix audit feature per the clarification ("MCP at run: none").
