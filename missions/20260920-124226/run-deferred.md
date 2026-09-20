
## AS-011 — deferred after 5 attempts (loop guard)
_Attempts: F067, F071, F075, F079, F080_
_Root cause: page.tsx propagates people param but test feeds literal href strings to WeekView; any mutation at the call site in page.tsx passes green. True fix requires either a server-component test or an integration test, which is out of M6 scope._

## AS-055 — deferred (ResizeObserver/real layout not testable in jsdom)
_The "when it does not fit" clause requires measuring actual pixel width. The component never calls ResizeObserver — it relies solely on the maxVisibleAvatars prop. A non-default-prop test exists (F083) and catches slice direction mutations, which is the strongest coverage achievable without a real browser._

## AS-056/AS-059 — deferred to F031 (M7 structural)
_page.tsx passes entire active roster as blockUserIds regardless of selection. This is a known structural hole documented in the AS-059 caveat. F031 fixes it in M7._

## AS-001 — deferred after 5 attempts (loop guard)
_Assertion roots: AS-001, AS-059_
_Last handoff: F104-handoff.md_
_Decision: 2026-09-20_

**⚠️ PRIVACY-AFFECTING PRODUCTION DEFECT**: When `parsePeopleParam(peopleParam ?? "all", …)` is in place (or equivalent), all workspace members' calendar blocks leak on a no-param page load. The scrutiny confirmed this survived all 5 follow-up attempts because no test ever imports or renders CalendarPage directly. The fix is known (render CalendarPage in a test with mocked I/O), but 5 follow-up attempts have been exhausted.

Manual action recommended: verify page.tsx:126 does NOT contain `?? "all"` before shipping.

## AS-023 — deferred after 5 attempts (loop guard)
_Assertion roots: AS-023_
_Last handoff: F104-handoff.md_
_Decision: 2026-09-20_

5 follow-up attempts (F088, F094, F097, F102, F104) all failed to cover the layout branch inversion mutation. Inverting "stacked"↔"week-grid" at page.tsx:245 passes 167 tests. Root cause: CalendarPage is never rendered in any test. Scrutiny recommends extracting the layout decision into a pure selector as a permanent fix.
