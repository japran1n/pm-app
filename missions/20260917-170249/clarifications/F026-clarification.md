# F026 Clarification

_Generated: 2026-09-17T00:00:00Z_  _Mode: accept-and-continue — ★ defaults taken for all questions, no interactive session. The user explicitly instructed the orchestrator to proceed through the full mission autonomously._

## Round A — 10 task questions

**1. Implementation pattern**
- (a) a Client Component using React state/hooks, composed from smaller components per the file layout in tech-decisions.md                    ★ recommended  ← chosen
- (b) a class component
- (c) a state-machine library (XState etc.)
- (d) a third-party form/editor framework

**2. Rendered states**
- (a) empty / typing / converting (loading) / success / error — all four explicitly designed, matching AS-024/AS-025/AS-026/AS-029                    ★ recommended  ← chosen
- (b) only success and error states
- (c) a single generic "loading" state for everything
- (d) no explicit state design, ad hoc

**3. State / storage location**
- (a) component-local React state; editor contents also mirrored to localStorage per F027 (client-only, no server round trip)                    ★ recommended  ← chosen
- (b) global state store (Redux/Zustand)
- (c) URL query params
- (d) server-persisted draft

**4. Loading state design**
- (a) disable the triggering control and show inline text/spinner, no full-page overlay — this is a small, fast, single-pane tool                    ★ recommended  ← chosen
- (b) full-page loading overlay
- (c) skeleton screens
- (d) no loading state, instant assumed

**5. Failure / error handling**
- (a) inline message near the control that failed, using pm-app's existing toast/alert primitives where one fits                    ★ recommended  ← chosen
- (b) a modal dialog
- (c) redirect to an error page
- (d) silent console log only

**6. Empty / zero state**
- (a) placeholder text in each editor explaining what to paste (matching the reference prototype's placeholder copy, trimmed)                    ★ recommended  ← chosen
- (b) a separate onboarding empty-state illustration
- (c) no placeholder, blank box
- (d) auto-filled example content

**7. Responsive breakpoints**
- (a) desktop-only per discovery (round 1, Q14) — no responsive design work beyond not visibly breaking on a laptop-width screen                    ★ recommended  ← chosen
- (b) fully responsive down to mobile
- (c) tablet-optimized
- (d) no consideration given

**8. Performance budget**
- (a) not a constraint — debounced preview updates (~300ms) are the only timing-sensitive behavior, matching AS-018                    ★ recommended  ← chosen
- (b) <16ms per keystroke (60fps)
- (c) <100ms interaction latency
- (d) not considered

**9. Auth / access control**
- (a) inherits the page-level workspace-membership gate; this component itself performs no separate check                    ★ recommended  ← chosen
- (b) re-checks auth client-side
- (c) role-based UI hiding
- (d) no access control at this layer

**10. Dependencies on existing code**
- (a) reuses existing components/ui/ primitives (buttons, tabs, etc.) where one already exists, per tech-decisions.md's "reuse before building" convention                    ★ recommended  ← chosen
- (b) builds new primitives freely
- (c) depends on a new third-party UI library
- (d) copies the standalone prototype's raw HTML/CSS verbatim

## Round B — 5 follow-ups

**11. Component library check — Before building this UI piece, which existing components/ui/ primitive (if any) should be checked first?**
- (a) whatever matches the control type — Tabs for F025, Button/Card for most others, Dialog for F027's confirm step — check components/ui/ during implementation rather than assuming one exists                    ★ recommended  ← chosen
- (b) always build new, never reuse
- (c) always reuse even if the fit is poor
- (d) no check needed, freehand Tailwind

**12. Theming — How should this component pick up pm-app's design-system tokens rather than hardcoded colors?**
- (a) Tailwind utility classes referencing the existing token/CSS-variable names already used elsewhere in the app (see other components under components/ for the exact class names)                    ★ recommended  ← chosen
- (b) a new one-off stylesheet
- (c) inline styles
- (d) CSS modules

**13. Debounce/timing values — Where timing matters (e.g. preview debounce), should the value match the prototype's exact numbers?**
- (a) yes, ~300ms for preview debounce, matching the standalone prototype's proven-comfortable value                    ★ recommended  ← chosen
- (b) a shorter debounce for snappier feel
- (c) a longer debounce to reduce iframe rebuilds
- (d) no debounce, update on every keystroke

**14. Copy/wording source — Where should button labels, help text, and warning-message wording come from?**
- (a) adapted from the standalone prototype's existing UI copy (already user-tested in the sense that it was written to be clear about a genuinely confusing clipboard mechanism), trimmed/reworded only where pm-app conventions differ                    ★ recommended  ← chosen
- (b) written fresh with no reference
- (c) kept as terse as possible, minimal copy
- (d) placeholder copy, TBD by design review

**15. Cross-component coordination — How do sibling components (e.g. editor and preview) share state without prop-drilling getting unwieldy?**
- (a) lift shared state to the nearest common parent (converter-page.tsx) and pass down as props — the state tree here is shallow enough that no context/store is needed                    ★ recommended  ← chosen
- (b) React Context
- (c) a global store
- (d) each component manages its own state independently with no coordination

## Round B — 5 "definition of done" questions

**16. Primary success test**
- (a) a colocated component test (React Testing Library) plus one manual check against the running dev server                    ★ recommended  ← chosen
- (b) unit test only
- (c) end-to-end Playwright test only
- (d) all three

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
- (a) test output (and, for UI features, a screenshot of the working control) attached to the handoff
- (b) a screenshot only
- (c) log lines only
- (d) all of the above                    ★ recommended  ← chosen
