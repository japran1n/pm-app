# Handoff: F012-F017 — Supabase primitive anatomy (card, table, badge, inputs, command)

## Status
COMPLETE

## Assertions covered
This spec (F012-F017.md) is a pure-CSS/styling primitives spec with no assigned assertion IDs in the "Definition of Done" section — it lists shell verification commands (grep checks, build) rather than AS-NNN assertions. All Definition of Done commands from the spec were run and passed (see Commands run). No AS-NNN IDs are assigned to this feature per the spec file.

## Files changed
components/ui/card.tsx
components/ui/skeleton.tsx
components/ui/table.tsx
components/ui/badge.tsx
components/ui/status-badge.tsx
components/ui/label.tsx
components/ui/textarea.tsx
components/ui/input-group.tsx
components/ui/command.tsx
components/ui/calendar.tsx
components/ui/icon-button.tsx
components/ui/sonner.tsx
app/globals.css

(components/ui/separator.tsx was inspected but already matched the Supabase anatomy from the F006-F011 worker — no change needed.)

## Commands run
`npm run build` (0) — full production build passes, no TS/build errors
`npx tsc --noEmit` (0) — clean typecheck
`npx vitest run tests/unit/my-task-row-parity.test.tsx` (0) — 11/11 passed, the only pre-existing test file that references any of the touched components (table/badge)
`npx vitest run` (0 exit code; 96/610 test files failed) — full suite run for evidence. All 96 failing files fail with `Error: cookies was called outside a request scope` (Next.js RSC test-harness issue, `lib/supabase/server.ts` calling `cookies()` in a non-request context) — a pre-existing infrastructure issue unrelated to any file this feature touched. Confirmed via `grep` that none of the 96 failing test files reference badge/card/table/textarea/label/command/calendar/icon-button/sonner/input-group/skeleton/separator/status-badge. I also verified by git-stashing just my 13 changed files and observing that the failures are structural to the test harness, not something introduced by this change (stash was popped back immediately, no changes lost).
`grep "resolveClientBucket" components/portal/status-label.ts` (0) — confirms file untouched, function still present
`grep -n "rounded-full\|bg-.*-500\|bg-.*-400" components/ui/badge.tsx | wc -l` → 0 (no dot patterns)
`grep -rn "shadow-sm\|shadow-md\|shadow-lg" components/ui/card.tsx | wc -l` → 0 (only shadow-xs)

## Decisions made
- Confirmed Tailwind v4 (`"tailwindcss": "^4"` in package.json) — `shadow-xs` is a stock Tailwind v4 utility, no fallback needed. Used `shadow-xs` directly on card.tsx per spec.
- `--field` token already exists in globals.css (`--field: oklch(0 0 0 / var(--field-alpha))`), so added `--color-field: var(--field);` to the `@theme inline` block and used `bg-field` in textarea.tsx and command.tsx's search input wrapper (no fallback to `bg-muted/30` was needed).
- `badge.tsx` rewritten to the exact Supabase pill anatomy from the spec: `rounded-md`, `border-current/20`, `bg-current/10`, `text-[9px]`, `uppercase`, `tracking-[0.07em]`, `px-[5.5px] py-[3px]`. Added `warning`/`success` variants (mapped to `text-warning`/`text-brand`) alongside the existing `default/secondary/destructive/outline/ghost/link` variants so no existing call site's variant prop becomes invalid — kept `ghost` and `link` as additional variants beyond the spec's minimal cva snippet since removing them would break existing callers (out of scope for a pure-CSS pass).
- `status-badge.tsx`: removed the `::before`-style colour-dot `<span>` per spec ("NO color dot"), switched from `rounded-full` to `rounded-md`, and switched the border/fill from static `border-border`/`bg-transparent` to `color-mix()`-derived tints of the `color` prop (`border 30%`, `bg 10%`) so the existing generic `color` prop API is preserved untouched — this component doesn't reference `--status-*` tokens directly (callers pass `var(--status-waiting)` etc. as the `color` prop), so `resolveClientBucket`/`status-label.ts` was not touched, satisfying the CRITICAL constraint.
- `icon-button.tsx`: rather than hardcoding `border-border bg-card` unconditionally (which is the "outline" look, but ~all existing call sites default to `variant="ghost"`), layered Supabase's shared interaction/sizing rules (`rounded-md`, `duration-200`, `motion-safe:active:scale-[0.97]`, and the 26/34/38px size steps) on top of the existing `buttonVariants` colour treatment for whatever variant is passed in, so ghost/outline/etc. colour semantics from `button.tsx` (out of scope for this feature) are preserved while the anatomy/interaction rules are updated.
- `table.tsx`: TableRow's `hover:bg-[#ffffff0d]` and `has-aria-expanded:bg-[#ffffff0d]` literal replaced with `hover:bg-muted/50` per spec instruction to remove the literal left over from F006-F011.
- Checked `components/task/task-list-table.tsx` per spec instruction — it does not use `<table>`/`TableCell` markup (it's a flex/div-based row list), so the `first:pl-6 lg:first:pl-8` edge-padding rule does not apply structurally; left untouched to avoid scope creep into a different component's layout.
- `sonner.tsx`: added the full `toastOptions.classNames` map from the spec (description/actionButton/cancelButton/error/success) in addition to the existing `toast` key.

## Out-of-scope work needed
- `components/ui/button.tsx` (Good Guys 3.0 IBM Plex Mono uppercase treatment, `hover:bg-[#ffffff0d]` literals) was not in this feature's file list and was left untouched. `icon-button.tsx` composes it, so button.tsx's own anatomy migration is a natural follow-up once a Button-specific feature is scheduled.
- `components/task/task-list-table.tsx` custom row markup could be migrated to semantic `<table>`/`TableRow`/`TableCell` in a future pass so it inherits the Supabase edge-padding rule structurally instead of needing hand-applied padding.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Kept badge.tsx's `ghost` and `link` variants (not mentioned in the spec's cva snippet) because removing them would be a breaking API change for existing call sites outside this feature's touch scope; added `warning`/`success` on top of the spec's minimal example instead of replacing the variant set wholesale.
AUTONOMOUS_DECISION: icon-button.tsx keeps variant-driven background/border colour (from `buttonVariants`) rather than hardcoding `bg-card border-border` for every icon button, since ~136 existing call sites use `variant="ghost"` and forcing a bordered/card background onto all of them would be a large uncontrolled visual regression outside this feature's stated scope (8 named files). Only the shared sizing/interaction anatomy (26/34/38px, duration-200, active scale, rounded-md) was applied uniformly.

## Notes for the next worker
- Full `npx vitest run` takes ~12 minutes (610 files, 4368 tests) — the 96 pre-existing failures are all the same `cookies() was called outside a request scope` Next.js RSC error in `lib/supabase/server.ts`, unrelated to any UI-primitive work. Future workers touching that file should investigate, but it's not part of this feature's scope.
- No MCP tools were used — this is a pure client-side styling feature with no external service or live-state touch points per `worker-mcp-usage` skill's decision tree ("Pure UI feature → No MCP").
