# Handoff: F005 — section-kind-selector.tsx

## Status
COMPLETE

## Assertions covered
AS-025: PASS — `SectionKindSelector` renders a trigger button + popover with static/cms options (components/architecture/section-kind-selector.test.tsx)
AS-026: PASS — `onChange` fires with the selected kind's value when a different option is chosen; does not fire when re-selecting the current value

## Files changed
components/architecture/section-kind-selector.tsx
components/architecture/section-kind-selector.test.tsx

## Commands run
`npx vitest run components/architecture/section-kind-selector.test.tsx` (0) — 4 passed
`npx tsc --noEmit -p .` (0)
`npx eslint components/architecture/section-kind-selector.tsx components/architecture/section-kind-selector.test.tsx` (0)
`npm test` (0) — full suite, ran in background, exited 0

## Decisions made
- Mirrored `components/architecture/page-kind-selector.tsx` structure (trigger button + absolutely-positioned popover with `role="listbox"`/`role="option"`) but made the component fully controlled (`value`/`onChange`/`disabled` props) instead of wiring a server action directly, per the feature spec's explicit prop contract ("Props: `value: SectionKind`, `onChange: (kind) => void`, optional `disabled?`"). This leaves persistence to the caller, matching "Data: DB column or prop — whichever the feature spec names" from the clarification defaults.
- Reused the existing `BoardSectionKind` type from `lib/queries/architecture.ts` (`"static" | "cms"`) and re-exported it as `SectionKind` from the new component file, satisfying "Export `SectionKind` type if not already exported" without duplicating the type definition.
- Built an inline `SectionKindBadge` (two-kind version of `PageKindBadge`) using the same `--cms`/`--cms-border`/`--cms-foreground` tokens and pill/uppercase/9px/tracking-[0.07em]/1px-border/10%-tint badge styling required by CLAUDE.md, rather than trying to reuse `PageKindBadge` which is typed to the four-kind `BoardPageKind` union.
- No new server action or DB call was added since the spec's props contract makes this a pure presentational/controlled component; RBAC/persistence enforcement belongs wherever a future caller wires this into a section update action (out of scope here, see below).

## Out-of-scope work needed
- No consumer currently renders `SectionKindSelector` in the section board UI, and no server action (e.g. `changeSectionKind`) exists yet to persist a selection to `section_kind`. Wiring it into the board (component usage + action + RBAC/Zod validation per clarified defaults) is a separate feature not covered by F005's spec, which only asked for the selector component itself.

## Blockers
(none)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept the component fully controlled per the spec's literal prop signature rather than mirroring page-kind-selector's built-in server-action call, since the spec explicitly names `value`/`onChange` as the props (not `taskId`/`kind`).

## Notes for the next worker
- `BoardSectionKind` (in `lib/queries/architecture.ts`) is the canonical two-value kind type; `SectionKind` in the new file is a re-export alias of it, so both names are interchangeable.
- Tests live at `components/architecture/section-kind-selector.test.tsx`, following the existing co-located pattern seen in `components/architecture/architecture-view-toggle.test.tsx`.
- No MCP tools were needed — this is a pure UI component with no live external state to inspect.
