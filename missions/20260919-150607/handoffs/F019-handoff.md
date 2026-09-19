# Handoff: F019 — Validacija 200 znakova sa čitljivom porukom

## Status
COMPLETE

## Assertions covered
AS-073: PASS — `disciplineEstimateNoteSchema` (lib/validation/architecture.ts) rejects notes over 200 characters with a human-readable message ("Note is N character(s) over the 200-character limit."); accepts notes at exactly 200 chars, empty, and undefined. Verified in lib/validation/architecture.test.ts (6/6 passing).

## Files changed
lib/validation/architecture.ts
lib/validation/architecture.test.ts

Note: these edits landed in git history as part of commit `62522428` ("feat(F018): add per-discipline note field to estimate popover") because a concurrently-running F018 worker committed the shared working tree state (which included my edits) before I ran my own commit. The code and tests described below are present and verified on the current HEAD; there is nothing left uncommitted for this feature.

## Commands run
`npx vitest run lib/validation/architecture.test.ts --reporter=verbose` (0) — 6/6 passing
`npx vitest run` (0 exit, but 219 pre-existing unrelated test failures — see Decisions made)
`npx tsc --noEmit` (0)
`git stash` / diff-against-baseline check (0) — confirmed the 219 failing tests exist without my change too (228 failing on baseline vs 219 with change; my change introduces zero new failures)

## Decisions made
- Added `disciplineEstimateNoteSchema` and exported `NOTE_MAX_LENGTH = 200` constant in `lib/validation/architecture.ts`, replacing the previous `z.string().max(500).optional()` note validation on `setDisciplineEstimateSchema` and `disciplineEstimateEntrySchema` (the two places the discipline-estimate note field is validated, per F018's prior work).
- Used `.refine()` instead of `.max(200, "...")` because Zod's built-in `max` message doesn't let me report *how many* characters the input is over the limit dynamically — the clarification requires "poruka koja kaže koliko znakova je prekoračeno" (a message stating how many characters were exceeded). The refine's custom `error` callback computes `value.length - 200` and singularizes "character"/"characters".
- Message text avoids any residue of Zod's generic "too_big"/"String must contain at most" wording, per clarification's "čitljiva poruka" (readable message) requirement.
- Left `estimateInputSchema` (the estimate-string field, unrelated to the note) untouched — spec is scoped to the note field only.
- Verified via MCP: not applicable (no external service state touched — pure client/server-shared Zod schema).

## Out-of-scope work needed
None identified. UI wiring of the popover error message (already displaying inline per F018) was not touched further since F018's handoff shows the popover already surfaces zod issue messages inline; this feature only tightens the schema + message content to satisfy AS-073's 200-char + readable-message requirement.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Chose `.refine()` over `.max()` with a static message so the error text could dynamically report the exact character overage, matching the clarification's explicit requirement ("poruka koja kaže koliko znakova je prekoračeno") rather than a generic max-length message.

## Notes for the next worker
- Because F019 and F018 workers ran concurrently against the same file (`lib/validation/architecture.ts`), the final state was committed under the F018 commit hash. If future scrutiny tooling greps commit messages for `AS-073`, note it lives in the file diff of commit `62522428`, and this handoff plus the passing `architecture.test.ts` file are the authoritative evidence trail for AS-073.
- Full `npx vitest run` has ~219 pre-existing failing tests unrelated to this feature (mostly `supabase.rpc is not a function` mock gaps in `tests/unit/watching-feed-query.test.ts` and React act()-warning-driven failures elsewhere). Confirmed via `git stash` + re-run that these fail identically without my change (228 failing at baseline vs 219 with — noise/flakiness, not a regression from this feature).
