# F26 — Light/dark theme audit: architecture enrichment surfaces

Static code review of the 5 new UI surfaces introduced by mission
`20260918-architecture-enrichment`. Checked for hex colors, hardcoded
Tailwind color scales, mono number formatting, shadow usage, and DS token
usage.

## 1. `components/architecture/estimate-chip.tsx`

| Check | Result | Notes |
|---|---|---|
| No hex colors | PASS | none found |
| No hardcoded Tailwind color scales | PASS | none found |
| Numbers use mono | PASS | `formatMinutes` output rendered with `font-mono text-xs tabular-nums text-muted-foreground` (line 43) |
| Shadows | PASS | no shadow classes used |
| Token usage | PASS | `text-muted-foreground`, `hover:text-foreground`, uses `Button`/`Popover` primitives which resolve via DS tokens |

## 2. `components/architecture/discipline-estimate-popover.tsx`

| Check | Result | Notes |
|---|---|---|
| No hex colors | PASS | none found |
| No hardcoded Tailwind color scales | PASS | none found |
| Numbers use mono | PASS | total (line 95-97) and per-discipline `Input` values (line 108) both `font-mono text-xs tabular-nums` |
| Shadows | PASS | no shadow classes used |
| Token usage | PASS | `text-muted-foreground` (labels), `text-destructive` (validation errors, line 145) |

## 3. `components/architecture/estimate-summary.tsx`

| Check | Result | Notes |
|---|---|---|
| No hex colors | PASS | none found |
| No hardcoded Tailwind color scales | PASS | none found |
| Numbers use mono | PASS | site totals (line 59, 63), per-page discipline cells (line 89-91), per-page total (line 93-95) all `font-mono ... tabular-nums` |
| Shadows | PASS | card carries `shadow-xs` only (line 52), consistent with "cards carry shadow-xs" rule |
| Token usage | PASS | `bg-card`, `border-border`, `bg-muted/30` (empty state, line 41), `text-muted-foreground`, `text-destructive` (conflict indicator `!`, line 100) — matches "text-destructive for over-budget or conflict indicators" |

## 4. `components/architecture/node-meta-dialog.tsx`

| Check | Result | Notes |
|---|---|---|
| No hex colors | PASS | none found |
| No hardcoded Tailwind color scales | PASS | none found |
| Numbers use mono | FAIL → FIXED | keyword counter `{keywords.length}/30` (line 188) was plain `text-xs text-muted-foreground`; this is a count and must be mono per DS rule. Fixed to `font-mono text-xs tabular-nums text-muted-foreground`. |
| Shadows | PASS | no custom shadow classes; relies on `Dialog`/`DialogContent` primitive shadow |
| Token usage | PASS | `text-muted-foreground`, `hover:text-foreground`, form fields use DS `Input`/`Textarea`/`Select`/`Label` primitives |

## 5. `components/architecture/architecture-view-toggle.tsx` (Details toggle + loading state)

| Check | Result | Notes |
|---|---|---|
| No hex colors | PASS | none found |
| No hardcoded Tailwind color scales | PASS | none found |
| Numbers use mono | PASS | no numeric displays in this surface (icon-only toggle buttons + loading spinner) |
| Shadows | PASS | active toggle state uses `shadow-xs` only (lines 163, 175, 189), matches elevation-step pattern (`bg-background` active vs `text-muted-foreground` inactive) |
| Token usage | PASS | `bg-background`, `text-foreground`, `text-muted-foreground`, `border-border`, `bg-muted/30` (toggle group + canvas loading skeleton, line 28), `bg-border` (divider, line 181) |

## Violations found and fixed

- **node-meta-dialog.tsx:188** — keyword count display was not mono. Fixed:
  `className="font-mono text-xs tabular-nums text-muted-foreground"`.

## Re-audit after fix

Re-ran hex/hardcoded-color grep and manual review on all 5 files post-fix —
no remaining violations. `npx tsc --noEmit` passes with no errors.

## Overall verdict

**PASS** (1 violation found and fixed during this audit; all 5 surfaces now
compliant with light/dark theme and DS token rules).
