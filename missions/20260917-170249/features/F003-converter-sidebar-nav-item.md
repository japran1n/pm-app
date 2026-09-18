# F003: converter sidebar nav item

**Milestone:** M1 — Foundation
**Estimated worker time:** 20 minutes
**Depends on:** F002

## Assertion IDs covered
- AS-001
- AS-005
- AS-006
- AS-007
- AS-127

## Draft scope
- Add a "Webflow" nav item to components/nav/app-sidebar.tsx at the top level (same tier as Dashboard/Projects), using a lucide-react icon (e.g. Code2 or FileCode).
- Wire active-route highlighting via the existing usePathname pattern already used by sibling items.
- No per-workspace conditional — item always renders, matching AS-007.
- Confirm icon/label contrast holds in both light and dark theme (AS-127) — spot-check, formal audit is M7.

## Files (approximate)
components/nav/app-sidebar.tsx

## Notes for clarification
Follow the exact pattern of an existing simple nav item (not the Projects list, which is dynamic) — Dashboard or Kanban is the closer precedent.
- MCP at run: none




---

## Clarified implementation (from clarifications/F003-clarification.md)

- Implementation pattern: a Client Component using React state/hooks, composed from smaller components per the file layout in tech-decisions.md
- Rendered states: empty / typing / converting (loading) / success / error — all four explicitly designed, matching AS-024/AS-025/AS-026/AS-029
- State / storage location: component-local React state; editor contents also mirrored to localStorage per F027 (client-only, no server round trip)
- Loading state design: disable the triggering control and show inline text/spinner, no full-page overlay — this is a small, fast, single-pane tool
- Failure / error handling: inline message near the control that failed, using pm-app's existing toast/alert primitives where one fits
- Empty / zero state: placeholder text in each editor explaining what to paste (matching the reference prototype's placeholder copy, trimmed)
- Responsive breakpoints: desktop-only per discovery (round 1, Q14) — no responsive design work beyond not visibly breaking on a laptop-width screen
- Performance budget: not a constraint — debounced preview updates (~300ms) are the only timing-sensitive behavior, matching AS-018
- Auth / access control: inherits the page-level workspace-membership gate; this component itself performs no separate check
- Dependencies on existing code: reuses existing components/ui/ primitives (buttons, tabs, etc.) where one already exists, per tech-decisions.md's "reuse before building" convention

### Follow-up decisions
- Component library check: whatever matches the control type — Tabs for F025, Button/Card for most others, Dialog for F027's confirm step — check components/ui/ during implementation rather than assuming one exists
- Theming: Tailwind utility classes referencing the existing token/CSS-variable names already used elsewhere in the app (see other components under components/ for the exact class names)
- Debounce/timing values: yes, ~300ms for preview debounce, matching the standalone prototype's proven-comfortable value
- Copy/wording source: adapted from the standalone prototype's existing UI copy (already user-tested in the sense that it was written to be clear about a genuinely confusing clipboard mechanism), trimmed/reworded only where pm-app conventions differ
- Cross-component coordination: lift shared state to the nearest common parent (converter-page.tsx) and pass down as props — the state tree here is shallow enough that no context/store is needed

## Definition of done

- **Primary success test:** a colocated component test (React Testing Library) plus one manual check against the running dev server
- **Failure test:** a unit test on each error/warning branch this feature introduces
- **Manual verification:** follow the 2-3 step check named in this feature's own notes (or, for engine features with no UI, run the test file directly and read the output)
- **Side-effect verification:** a test or review confirms this feature touches only the files named in its own "Files" line — nothing else in the repo changes behavior
- **Evidence artifact:** all of the above

These five answers are what the milestone validators check. A worker is not
done until each definition-of-done answer is satisfied with concrete output
linked from the handoff.
