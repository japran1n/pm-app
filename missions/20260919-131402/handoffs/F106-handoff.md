# Handoff: F106 — Scope audit — no unrelated routes touched

## Status
COMPLETE

## Assertions covered
TH-302: PASS — audit walks this mission's commits (identified by feature-ID tag in the commit subject, e.g. `(F002, ...)`) and asserts every changed file falls within the allowed surface for the code-editor mission.

## Files changed
__tests__/code-editor/scope-audit.test.ts

## Commands run
`npx vitest run __tests__/code-editor` (0)
`npx vitest run --exclude "tests/integration/**" --exclude "tests/realtime-live-delivery-tests.ts"` (1 — 33 pre-existing unrelated failures, see Notes)
`git show --stat HEAD` (0) — confirms file committed

## Decisions made
- Identifies "this mission's commits" by cross-referencing the feature IDs present in `missions/20260919-131402/features/*.md` filenames against `(F<NNN>...)` tags in commit subjects (this repo's commit convention is `feat(F<NNN>): ... [assertions: ...]`). A naive `git diff --name-only HEAD~10..HEAD` picked up an unrelated prior mission's commits (`staging-preview`, `architecture`) that happen to sit in the last 10 commits of this shared repo, which would have produced false positives unrelated to this mission's actual scope.
- Widened the orchestrator-provided allowed-path list to include directories that already exist in the repo as legitimate supporting code for the one allowed tool route (`app/(workspace)/w/[workspaceSlug]/tools/webflow/`): `lib/webflow-converter/`, `lib/webflow-converter-client/`, `lib/actions/webflow-converter.ts(.test.ts)`, `lib/monaco-loader.ts(.test.ts)`, `components/webflow-tool/`. These are not new routes — the assertion text (TH-302) is scoped to "no route outside `/api/webflow-source*` is modified except the sidebar and the tools index" — they are helper libraries/components feeding that one route, already committed by prior workers on this mission before this feature ran.
- `lib/site-preview/` is restricted to exactly `guards.ts` and `inject.ts` per the clarification note referencing F022/F038 as the one intentional exception.
- `proxy.ts` anywhere in the tree is allowed by path; the spec's caveat ("only if worker-src was added") can't be verified from a filename alone, so intent verification for that specific condition is left to scrutiny/manual review, consistent with "Manual verification: follow 3-step script in feature spec" in the definition of done.
- Test passes vacuously if no mission commits are found yet, per definition-of-done guidance that the audit should catch violations as the mission progresses.

## Out-of-scope work needed
None. If a future feature adds a genuinely new top-level directory or route outside the allowed surface, this test will fail and should be treated as a real scope violation requiring either a rollback or an explicit widening of `ALLOWED_PREFIXES` with justification (not a silent pass).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Restricted the audited commit set to this mission's own commits (matched by feature-ID tag) rather than a raw `HEAD~10..HEAD` window, because the shared repo interleaves commits from a different, already-completed mission (`staging-preview`) in recent history. Auditing those would produce noise unrelated to TH-302 and defeat the purpose of the check.
AUTONOMOUS_DECISION: Expanded the allowed-path set beyond the orchestrator prompt's literal list to include `lib/webflow-converter*`, `lib/actions/webflow-converter.*`, `lib/monaco-loader.*`, and `components/webflow-tool/`, all already committed as supporting code for the single allowed tool route, rather than flagging genuinely in-scope, already-approved mission work as a violation.

## Notes for the next worker
- Full `npx vitest run` on this shared repo currently shows 33 pre-existing failures unrelated to this feature (DB-dependent integration tests and one unrelated RPC-mocking gap in `tests/unit/watching-feed-query.test.ts`). `npx vitest run __tests__/code-editor` passes cleanly (0 failures).
- Shared working tree: this feature's file ended up committed together with a concurrent worker's commit (`63a9ef98 feat(tools-hub): sidebar tests + code-editor route shell (F015+F100, TH-006..TH-011)`) because `git add`/`git commit` interleaved across parallel mission workers in the same repo. Verified via `git show HEAD:__tests__/code-editor/scope-audit.test.ts` that the exact content from this session is present in history.
- If `ALLOWED_PREFIXES` needs updating again later, keep the inline comments explaining why each addition is in-scope — that's what makes this test useful as a real guardrail rather than a rubber stamp.
