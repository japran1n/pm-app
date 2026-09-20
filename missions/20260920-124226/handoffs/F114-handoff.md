# Handoff: F114 — Fix AS-069 bare patterns and delete scratch file

## Status
COMPLETE

## Assertions covered
AS-069: PASS — test_AS_069_no_capacity_figure_in_any_planner_file now catches bare "40h booked"/"80% booked"-style figures (verified with a temporary `<span>40h booked this week</span>` mutation in stacked-planner.tsx, which made the test fail as expected; reverted and confirmed the suite passes again). Also verified eslint no longer fails since the scratch file causing 3 errors is deleted.

## Files changed
tests/unit/f036-stacked-scroll-colour.test.tsx
tests/unit/zz-dbg.test.tsx (deleted; was untracked, never committed to git)

## Commands run
`npx tsc --noEmit` (0)
`npx eslint . --max-warnings=0` (0)
`npx vitest run tests/unit/f036-stacked-scroll-colour.test.tsx` (0, 10/10 passed)
`rm tests/unit/zz-dbg.test.tsx` (0)

## Decisions made
- Added `existsSync` filter over a `candidateFiles` list so the sweep gracefully skips files that don't exist yet, per spec. Confirmed `components/calendar/week-agenda.tsx`, `components/calendar/calendar-block-chip.tsx`, and `components/calendar/time-off-day-strip.tsx` all exist and added all three to the sweep (spec only explicitly named the first two plus asked me to check for `TimeOffDayStrip`, which I found at `time-off-day-strip.tsx`).
- Initially added a fully bare `\b\d+\s*h\b(?!\s*[\d:a-zA-Z])` pattern per one of the spec's suggested options, but it produced a false positive against unrelated Tailwind class fragments like `...bottom-0 h-1.5 cursor-ns-resize` in `calendar-block-chip.tsx` (the "0 h-1.5" text matched `\d+\s*h\b` since `-` is a non-word boundary). Removed that pattern and relied only on the context-requiring patterns (`\d+\s*h\s+(total|booked|load|available|utili|spent|work)`, `\d+\s*%\s+(booked|load|utili|capacity|total)`, `booked\s*:\s*\d`) which still catch the mutation "40h booked this week" without any false positives across the current sweep files. AUTONOMOUS_DECISION: chose the narrower, context-anchored regex set over the fully bare hour pattern the spec suggested as one option, because the spec itself listed multiple candidate approaches and explicitly said "be careful not to catch CSS percentages" — the bare-`h` variant broke that constraint against real source, so I used the "Simpler fix" variant from the spec instead, which the spec also explicitly offered.
- Deletion of `tests/unit/zz-dbg.test.tsx` required no git action beyond `rm` since the file was untracked (never committed).
- My edits to `tests/unit/f036-stacked-scroll-colour.test.tsx` were picked up by a concurrent worker's commit `ed6cc3d4` (message references F113) before I ran `git commit` myself — `git show ed6cc3d4 -- tests/unit/f036-stacked-scroll-colour.test.tsx` confirms it contains exactly my diff (existsSync import, candidateFiles/plannerFiles split, the three new files, the three new regex patterns). Working tree is clean; no separate F114 commit was needed or possible since there was nothing left to stage. Did not attempt to rewrite or re-commit history.

## Out-of-scope work needed
None identified.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used the spec's "Simpler fix" context-anchored regex list (bare-hour-with-following-word, bare-percent-with-following-word, `booked:\s*\d`) instead of the fully bare `\d+\s*h\b` lookahead variant also suggested in the spec, because the latter produced false positives against existing Tailwind utility classes (e.g. `h-1.5`) in `calendar-block-chip.tsx`. The chosen patterns still catch the required mutation test string "40h booked this week".

## Notes for the next worker
The repo appears to run with a shared working tree across concurrent worker processes during this run — my test-file edits were swept into another feature's commit (`ed6cc3d4`, "fix(F113): ..."). If you see `git commit` report "nothing to commit" after making real edits, check `git log -1 -- <file>` and `git show <that commit> -- <file>` before assuming failure; the change may already be committed under a sibling feature's commit message. Verify with `git diff <commit>^..<commit> -- <file>` matching your intended diff exactly, as I did here.
