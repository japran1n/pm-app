# F042 Clarification

_Generated: 2026-09-17T00:00:00Z_  _Mode: accept-and-continue — ★ defaults taken for all questions, no interactive session. The user explicitly instructed the orchestrator to proceed through the full mission autonomously._

## Round A — 10 task questions

**1. Implementation pattern**
- (a) a review-and-fix pass against already-built code plus, where a gap is found, a small targeted patch — not new features                    ★ recommended  ← chosen
- (b) a large rewrite
- (c) a new automated tool built from scratch
- (d) documentation only, no code changes

**2. Data shape**
- (a) not applicable — this feature touches process/quality, not data                    ★ recommended  ← chosen
- (b) a new report table
- (c) a JSON report file
- (d) a dashboard

**3. State / storage location**
- (a) not applicable                    ★ recommended  ← chosen
- (b) a new tracking table
- (c) CI artifact storage
- (d) local file only

**4. API contract**
- (a) not applicable — no new endpoint or function surface                    ★ recommended  ← chosen
- (b) a new CLI command
- (c) a new npm script
- (d) a new API route

**5. Failure / error handling**
- (a) any gap found is fixed directly (small patch) rather than merely reported, since this is the mission's own closing quality gate                    ★ recommended  ← chosen
- (b) gaps are only logged for a future mission
- (c) gaps block the whole mission until a human decides
- (d) gaps are ignored if minor

**6. Empty / zero state**
- (a) not applicable                    ★ recommended  ← chosen
- (b) n/a
- (c) n/a
- (d) n/a

**7. Validation rules**
- (a) every check in this feature's scope bullets must actually pass, not just "mostly pass"                    ★ recommended  ← chosen
- (b) best-effort only
- (c) sampling-based check
- (d) no explicit bar, subjective judgment

**8. Performance budget**
- (a) not applicable                    ★ recommended  ← chosen
- (b) n/a
- (c) n/a
- (d) n/a

**9. Auth / access control**
- (a) not applicable — this is a build-time/process-time check, not a runtime access surface                    ★ recommended  ← chosen
- (b) n/a
- (c) n/a
- (d) n/a

**10. Dependencies on existing code**
- (a) reviews the accumulated output of every feature in its "Depends on" line                    ★ recommended  ← chosen
- (b) reviews the whole repo from scratch
- (c) reviews only its own prior output
- (d) no defined scope

## Round B — 5 follow-ups

**11. Scope boundary — If this QA feature finds an issue outside its own named scope, what happens?**
- (a) note it, but only fix what is in scope; flag out-of-scope findings for a separate follow-up rather than silently expanding this feature                    ★ recommended  ← chosen
- (b) fix everything found regardless of scope
- (c) ignore anything not explicitly named
- (d) stop the whole mission until a human decides

**12. Tooling — What existing repo tooling should this feature reuse rather than introduce new tooling for?**
- (a) whatever the repo already runs for lint/test/build (npm run lint, npm test, npm run build) — no new tool is introduced by this mission                    ★ recommended  ← chosen
- (b) a new dedicated CI job
- (c) a new third-party SaaS quality tool
- (d) manual review only, no tooling

**13. Evidence format — What does this feature's handoff report look like?**
- (a) a short pass/fail per scope bullet with command output pasted where relevant (matching this repo's existing handoff convention)                    ★ recommended  ← chosen
- (b) a long narrative report
- (c) a screenshot-only report
- (d) no report, just a commit

**14. Re-run policy — If a later feature changes code this QA feature already checked, does it need to re-run?**
- (a) yes — this feature's checks are meant to be cheap to re-run and should be re-run as part of F041 (the final build/lint/typecheck gate) regardless                    ★ recommended  ← chosen
- (b) no, one-time check only
- (c) only if explicitly requested
- (d) not defined

**15. Severity handling — If a finding is minor/cosmetic, does it block mission completion?**
- (a) no — only findings that violate a named assertion ID block completion; cosmetic findings are noted but not blocking                    ★ recommended  ← chosen
- (b) yes, every finding blocks
- (c) severity is not distinguished
- (d) orchestrator judgment call each time with no stated rule

## Round B — 5 "definition of done" questions

**16. Primary success test**
- (a) command output (lint/test/build) showing green, pasted into the handoff                    ★ recommended  ← chosen
- (b) a unit test
- (c) a screenshot
- (d) a manual sign-off with no artifact

**17. Failure test**
- (a) a unit test on each error/warning branch this feature introduces                    ★ recommended  ← chosen
- (b) an integration test forcing failure
- (c) a chaos test
- (d) error paths tested manually only

**18. Manual verification**
- (a) follow the 2-3 step check named in this feature's own notes (or, for engine features with no UI, run the test file directly and read the output)                    ★ recommended  ← chosen
- (b) a full demo to the user
- (c) reading log lines only
- (d) none — automated tests suffice

**19. Side-effect verification**
- (a) a test or review confirms this feature touches only the files named in its own "Files" line — nothing else in the repo changes behavior                    ★ recommended  ← chosen
- (b) a snapshot test of unrelated data
- (c) no side-effect check
- (d) not applicable

**20. Evidence artifact**
- (a) test output (and, for UI features, a screenshot of the working control) attached to the handoff                    ★ recommended  ← chosen
- (b) a screenshot only
- (c) log lines only
- (d) all of the above
