# Handoff: F072 — Fix AS-061 Playwright mobile reachability spec

## Status
COMPLETE

## Assertions covered
AS-061: PASS — updated `tests/unit/people-switcher-placement-a11y.test.tsx` to reject bare `hidden` and every responsive-prefixed variant (`sm:hidden`, `md:hidden`, `lg:hidden`, `xl:hidden`, `2xl:hidden`, and their `max-*` forms) on the trigger's className. Verified via mutation testing that adding `sm:hidden`, `md:hidden`, or bare `hidden` to the trigger in `components/calendar/people-switcher.tsx` each independently makes the test FAIL, and the test PASSES on the unmodified component.

## Files changed
tests/unit/people-switcher-placement-a11y.test.tsx

## Commands run
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` (0) — 6/6 passed on unmodified source
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` with `sm:hidden` mutation in people-switcher.tsx trigger className (1) — 1/6 failed as required, then reverted
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` with `md:hidden` mutation (1) — 1/6 failed as required, then reverted
`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx` with bare `hidden` mutation (1) — 1/6 failed as required, then reverted
`npx tsc --noEmit -p tsconfig.json` (0) — no output, clean

## Decisions made
- Did not build the Playwright E2E spec (`tests/e2e/m6-people-switcher-mobile.spec.ts`) or the CSS-in-test fallback described in the spec's "Fix" section. The spec's own "Fix" section resolves down to a concrete, sufficient instruction for the jsdom path: "the real fix is to assert `!className.split(/\s+/).some(t => /^(sm:|md:|lg:|xl:|max-sm:|max-md:)?hidden$/.test(t))`". I implemented that regex approach (extended slightly to also cover `2xl:` and `max-lg:`/`max-xl:` for completeness) directly in the existing jsdom test file, which is the file explicitly named in the "Gate" section (`npx vitest run tests/unit/people-switcher-placement-a11y.test.tsx`) as the thing that must pass and must fail under the two named mutations. Since the Gate — the actual definition-of-done check — only exercises this file and these two mutations, and both are satisfied, I judged the Playwright/CSS-in-test alternative paths in the "Fix" section as optional elaboration rather than required scope for this narrowly-defined bug-fix feature.
- Kept the regex slightly broader than the literal example in the spec (added `2xl:`, `max-lg:`, `max-xl:`) since Tailwind supports these breakpoints too and the assertion's intent ("reject ALL responsive Tailwind hidden variants") is best served by full breakpoint coverage rather than the shorthand list given as an example.

## Out-of-scope work needed
- The repo's working tree already had unrelated uncommitted modifications in `components/calendar/people-switcher.tsx` (an `onSelect` handler change unrelated to this fix), `tests/unit/people-switcher-multiselect.test.tsx`, `tests/unit/people-switcher.test.tsx`, `tests/unit/f029-switcher-url-wiring.test.tsx`, `next-env.d.ts`, and `missions/20260920-124226/plan.md` before I started. Running the full `tests/unit` suite showed 135 pre-existing failures (42 files) unrelated to AS-061/F072, e.g. `people-switcher-multiselect.test.tsx` AS-055 avatar-identity tests failing against the current component state. These are not part of this feature's scope and were not touched or fixed here — flagging for a separate cleanup feature since they indicate the working tree has an in-progress, uncommitted change to `people-switcher.tsx` that is inconsistent with several test files.
- The Playwright E2E spec at `tests/e2e/m6-people-switcher-mobile.spec.ts` described in the spec's "Fix" section was not created (see Decisions made above for rationale). If the orchestrator determines a live-browser E2E check is still required in addition to the jsdom regex fix, that should be a separate follow-up feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated the jsdom regex fix (explicitly spelled out in the spec and matching the Gate's exact test command) as the complete required deliverable for this bug-fix feature, rather than also authoring the Playwright E2E spec or CSS-in-test fallback, since the Gate section — which defines pass/fail for this feature — only names the vitest file and its two mutations.
AUTONOMOUS_DECISION: Extended the regex to cover `2xl:`, `max-lg:`, and `max-xl:` prefixes beyond the example list in the spec, to fully satisfy "reject ALL responsive Tailwind hidden variants" as stated in the task instruction.

## Notes for the next worker
- Test file: `tests/unit/people-switcher-placement-a11y.test.tsx`, assertion block starting at line ~165 (`describe("F030: people switcher at mobile viewport width (AS-061)"`).
- New pattern used: `/^((max-)?(sm|md|lg|xl|2xl):)?hidden$/` tested against each whitespace-split className token.
- I left `components/calendar/people-switcher.tsx` exactly as it was found (with its pre-existing uncommitted diff) — I only mutated it transiently on disk to verify the test fails, then restored it from a `/tmp` backup before running `git add`/`git commit`, so `git status --short` after my commit still shows that file modified (pre-existing, not mine).
- No MCP tools were relevant to this fix (pure local test-logic change, no external service).
