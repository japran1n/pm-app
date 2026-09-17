# Handoff: F085 — fix 3-level combo chain parentage (AS-117)

## Status
COMPLETE

## Assertions covered
AS-117: PASS — 3-level combo chain `.a.b.c` now resolves `comb` to the `.a.b` composite base (`idByKey.get(comboOf.join("|"))`) instead of the bare-name-matched standalone `.b` style; missing-base case emits a warning and sets `comb: ""` instead of silently falling back. 2-level chains (existing behavior) still pass unchanged.

## Files changed
lib/webflow-converter/emit.ts
lib/webflow-converter/emit.test.ts

## Commands run
`npx vitest run lib/webflow-converter/emit.test.ts` (0) — 28 passed
`npx vitest run lib/webflow-converter/` (0) — 362 passed across 9 files
`npx tsc --noEmit` (0)
`npm run lint` (0)

## Decisions made
- Replaced the single-line `immediateBase`/`?? ""` lookup with an explicit block: compute `baseKey = rec.comboOf.join("|")`, look up `idByKey.get(baseKey)`, and only fall back to `comb: ""` while also pushing a warning (via the shared `warnings` array already threaded into `buildStyles`) when the base id isn't found. This matches the spec's exact wording for the warning message format (`combo class "<name>" references base "<chain>" which has no style definition — combo parentage skipped`), using `rec.comboOf.join(".")` for the human-readable chain in the message.
- Did not change the second pass that populates `children` — it keys off `style.comb` matching a style's `_id`, which is unaffected by the key-lookup fix (it already worked correctly once `comb` itself points to the right base).
- Test fixtures: had to disambiguate `find()` calls by `s.comb !== ""` / `s.comb === ""` where a class name appears both as a standalone style and as a combo (e.g. `.b` and `.a.b` both produce a style named `"b"`) — this mirrors the existing AS-117 2-level test's pattern in the file, so I kept the new tests consistent with it.

## Out-of-scope work needed
None identified. Confirmed convert.ts and validator.ts were not touched, per spec.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Warning message wording follows the spec's provided template verbatim (`combo class "<name>" references base "<chain>" which has no style definition — combo parentage skipped`), since the spec gave an explicit code snippet for this rather than leaving it to worker judgment.

## Notes for the next worker
- css.ts's `idByKey`/`order` keys: standalone classes are keyed by bare name (e.g. `"b"`); combo chains are keyed by the full pipe-joined chain including the terminal class (e.g. `"a|b|c"` for `.a.b.c`). The *base* for a combo is one level up — `comboOf.join("|")` — which for `.a.b.c` (`comboOf = ["a","b"]`) is `"a|b"`, the key for the `.a.b` combo rule if one was ever defined in the source CSS. If `.a.b` was never defined as its own rule, no such key exists and the warning fires — this is expected/correct behavior per the spec, not a bug.
- No MCP tools used — this is a pure local TS unit-level bugfix, no external service state involved.
