# F092: readme docs

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 25 minutes
**Depends on:** F080

## Assertion IDs covered
- AS-159

## Draft scope
- README: how to run the app locally, how to run tests, full list of required environment variables with descriptions

## Files (approximate)
README.md

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Structure:** overview, prerequisites, setup, run, test, environment variables (table format matching `.env.example` order), Known Limitations.
- **Accuracy:** every documented command is actually run and confirmed to match tech-decisions.md exactly before this feature is marked COMPLETE.
- **Audience:** the user's future self returning to a solo project, not a public open-source audience.
- **Scope:** setup/run/test/env only — full architecture reasoning stays in tech-decisions.md, not duplicated here.

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
