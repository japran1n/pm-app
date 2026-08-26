# Handoff: F338 — pair priority colour with text/labels and fix real contrast failures (M18 scrutiny BLOCKER-2/MAJ-3)

## Status
COMPLETE

## Assertions covered
AS-525: PASS — Priority is no longer colour-only anywhere. Calendar: `components/calendar/day-cell.tsx`, `agenda-list.tsx`, `day-overflow.tsx` each pair the `aria-hidden` priority dot with a new `sr-only` `PRIORITY_LABELS[priority]` span. Timeline: `components/timeline/timeline-bar.tsx` and `timeline-bar-draggable.tsx` fold `(${priorityLabel} priority)` into the existing `aria-label`/`title`, which also covers the `layout.kind !== "range"` marker branch that renders no visible text at all. Verified with new unit tests in `tests/unit/f338-priority-a11y-contrast.test.tsx`.
AS-526: PASS — Three real sub-4.5:1 text placements fixed: (1) `timeline-bar.tsx`/`timeline-bar-draggable.tsx` no longer hardcode `text-white`; both now use a new `PRIORITY_TEXT_ON_COLOR` map (`lib/task-colors.ts`) that picks whichever of black/white clears 4.5:1 against each fixed `PRIORITY_COLORS` hex. (2) `app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx`'s priority Badge no longer uses `PRIORITY_COLORS` as text colour (was 3.56–3.76:1 on white for urgent/high/low); it now keeps the colour-coded border (3:1 threshold, unaffected) and uses `text-foreground` for the label text. Also fixed the systematically wrong test baseline: the dot contrast tests measured `--card`/`--sidebar` but the dots actually render inside `<Badge variant="secondary">` (`--secondary`) or the sidebar's `bg-sidebar-accent` hover/active row. Re-pointed `tests/unit/task-colors-contrast.test.ts` and `tests/unit/project-nav-dot-contrast.test.ts` to the real surfaces, which surfaced three additional genuine failures now fixed in source: `STATUS_COLORS.in_review` (amber-600 2.90:1 → amber-700), `STATUS_COLORS.done` (green-600 2.998:1, just under 3:1, → green-700), and the sidebar dot palette's `bg-amber-600` (2.92:1 on light accent row → `bg-amber-700`) and `bg-purple-600` (2.81:1 on dark accent row → `bg-purple-500`).

## Files changed
components/calendar/agenda-list.tsx
components/calendar/day-cell.tsx
components/calendar/day-overflow.tsx
components/timeline/timeline-bar.tsx
components/timeline/timeline-bar-draggable.tsx
components/nav/project-nav-list.tsx
lib/task-colors.ts
app/(workspace)/w/[workspaceSlug]/my-tasks/page.tsx
tests/unit/task-colors-contrast.test.ts
tests/unit/project-nav-dot-contrast.test.ts
tests/unit/f338-priority-a11y-contrast.test.tsx (new)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint .` (0, 6 pre-existing unused-var warnings, unchanged set)
`npx vitest run tests/unit` (0 — 168 files / 1339 tests passed; one pre-existing unhandled-rejection artefact in `tests/unit/user-avatar.test.tsx`, same one the M18 scrutiny report already documented as harmless)
`npx next build` (0 — full route manifest emitted, no errors)
`git status --short` (clean after commit)

## Decisions made
- This worker resumed from two prior interrupted attempts. Verified via `git diff` that the partial work on `agenda-list.tsx`, `day-cell.tsx`, `day-overflow.tsx`, `timeline-bar.tsx`, and `lib/task-colors.ts` was already correct and complete before building on top of it — no rework needed there.
- Chose "fold priority into the accessible name/title" for the timeline bar/marker (matching the pattern the partial `timeline-bar.tsx` diff had already established) rather than an `sr-only` span, since the marker branch (`layout.kind !== "range"`) renders no visible text node at all — an `sr-only` span would need a wrapper element the marker doesn't have, whereas the existing `aria-label`/`title` already exists on every branch.
- `PRIORITY_TEXT_ON_COLOR` (added by the prior interrupted attempt, verified correct by independent WCAG contrast computation in this session) picks per-priority black or white text against each fixed `PRIORITY_COLORS` hex — a genuine per-colour pick since neither pure black nor pure white clears 4.5:1 against every one of the six values.
- For the dot-contrast test re-pointing (FU-G), fixing the newly-measured-correctly failing colours (`in_review`, `done`, sidebar `bg-amber-600`, `bg-purple-600`) required picking real replacement shades, not just adjusting the tests — verified each replacement clears 3:1 on *every* surface it's rendered on (light+dark `--secondary` for status/priority dots; light+dark `--sidebar` AND light+dark `--sidebar-accent` for the nav dots) using an independent Node WCAG contrast script before committing to the value, and cross-checked the oklch→sRGB conversion for `--secondary`/`--sidebar-accent` dark (`#262626`) against FU-G's own stated value.
- On `my-tasks/page.tsx`, kept the colour-coded `borderColor` (3:1 threshold, already passing) and only changed the *text* colour to `text-foreground`, per FU-G's specific instruction ("keep the border tint").
- Did not touch `tests/unit/task-card-badge-text-contrast.test.ts` or `tests/unit/column-colors-contrast.test.ts` — verified both already measure the correct real rendering surface (`--card`/`--muted` for the former; `bg-muted/30` over `--card` for the board column dot, which MAJ-3 did not flag as wrong for the latter), so no change was needed there.

## Out-of-scope work needed
Everything else in M18-scrutiny.md (BLOCKER-1 header-search keyboard operability, BLOCKER-3/4 e2e suite reproducibility and the mention-notification 500, MAJ-1/2/4/5/6/7/8, and all MIN items) is out of scope for this feature and untouched. FU-A through FU-C, FU-E, FU-F, FU-H, FU-I remain open follow-ups per the scrutiny report; only FU-D and the AS-526 portion of FU-G were in this feature's scope.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose green-700 (#15803d) over green-600 (#16a34a) for `STATUS_COLORS.done` because green-600 measured 2.998:1 against the real `--secondary` light background — technically just under the 3:1 AA threshold — which the scrutiny report's MAJ-3 text didn't explicitly call out (it only named `in_review` amber) but which the corrected test baseline caught regardless. This is a genuine additional contrast fix within FU-G's stated intent ("fix whichever specific colour entries then fail their corrected threshold"), not scope creep.
AUTONOMOUS_DECISION: Chose purple-500 (#a855f7) over other purple/violet shades for the sidebar nav dot palette because it's the only candidate that clears 3:1 on all four real surfaces the dot can render on (light/dark `--sidebar`, light/dark `--sidebar-accent`) simultaneously — verified numerically rather than picking the first "-600 in the same hue" shade that happened to work on one axis.

## Notes for the next worker
- No MCP tools were used — this is a pure UI/contrast-math feature with no external service or live data touched.
- The oklch→sRGB conversion used to derive `--secondary`/`--sidebar-accent` real hex values (`#f4f4f5`/`#262626` light/dark for `--secondary`, `#f5f5f5`/`#262626` for `--sidebar-accent`) was computed with a standalone OKLab/OKLCH→linear-sRGB conversion formula (Björn Ottosson's reference matrices) in a throwaway Node script, cross-checked against FU-G's own explicitly stated `#262626` for `--secondary`/`--muted` dark.
- If a future worker touches `PRIORITY_COLORS`, `PRIORITY_TEXT_ON_COLOR`, `STATUS_COLORS`, or the sidebar `DOT_COLORS` array again, re-run the contrast test suite (`task-colors-contrast.test.ts`, `project-nav-dot-contrast.test.ts`, `column-colors-contrast.test.ts`, `task-card-badge-text-contrast.test.ts`, and the new `f338-priority-a11y-contrast.test.tsx`) — several of these now assert against the *actual* rendering surface rather than an approximation, so a colour change failing one of them is a real regression, not a stale test.
