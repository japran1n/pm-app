# F085: keyboard a11y pass

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 30 minutes
**Depends on:** F073

## Assertion IDs covered
- AS-151

## Draft scope
- Audit + fix pass: every interactive element (buttons, inputs, drag handles) reachable and operable via keyboard alone, including dnd-kit's keyboard sensor path

## Files (approximate)
components/**/*

## Notes for clarification
Standard implementation per tech-decisions.md conventions; no special context beyond the assigned assertions.
- MCP at run: none


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Scope:** exactly the files/pattern named in "Files (approximate)" on this feature's spec — not a repo-wide rewrite.
- **Action on finding a gap:** fix directly in this feature if scoped narrowly; open a follow-up feature only if the fix requires touching code outside this feature's declared scope.
- **On no gap found:** document "already compliant" explicitly in the handoff rather than silently doing nothing.
- **Evidence:** a passing automated test per assertion where feasible; a written note in the handoff for structural/negative-only assertions (e.g. "no X exists in the codebase").

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
