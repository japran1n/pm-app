# F019: Portal — Hours view and the burn-down chart

**Milestone:** M4
**Estimated worker time:** 3 h
**Depends on:** F017, F018

## Assertion IDs covered
- AS-034: The portal Hours view shows cumulative billable hours used against the planned curve, week by week.
- AS-038: The portal shows hours broken down by work category, and every category shown has a stated value.

## Scope

Replaces the stub at `p/[projectId]/hours/page.tsx`. Reads
`project_hours_client` only — the team RPC must not be importable from
anything under `app/(portal)` or `components/portal`.

### 1. Four tiles

Used · Remaining · This week · Against plan (signed, with the done token
when under and the waiting token when over).

### 2. Burn-down chart

Inline SVG, no chart library.

- One y-scale. Cumulative hours, x = ISO weeks of the budget period.
- **Used** — solid 2px line in the brand colour with a light area fill,
  ending in an emphasised endpoint carrying a direct label.
- **Planned** — 2px dashed line in muted ink. The planned curve is the
  budget spread evenly across the period unless a better basis exists;
  say which in the caption rather than implying precision the number
  does not have.
- **Budget ceiling** — a labelled horizontal rule.
- Crosshair on hover with used / planned / difference for that week, in
  one shared tooltip element.
- Legend naming all three. Two series always get a legend.
- The chart scrolls inside its own container; the page never scrolls
  sideways.
- Chart text takes theme tokens so it reads in both themes.

Guard the degenerate cases properly: no budget yet → the view says so
and shows only the used curve; a period not yet started → no chart, one
honest line.

### 3. By category

Horizontal bars, single hue, direct value labels. Identity comes from
the row label, so no categorical palette is needed and none should be
invented. Uncategorised is shown as its own row named "Uncategorised",
never silently folded into another.

### 4. By month

A small table with a note per month. Reuses the same RPC's weekly data
aggregated up — do not add a third read path.

### 5. Honesty line

A caption under the chart: "Billable hours only. Internal review and
rework are not billed to you." That sentence prevents the most common
client question about any burn-down, and it happens to be true here
because of how F017 computes.

## Definition of done

- **Primary success test:** unit — given a fixed RPC payload the chart
  renders the right number of points, the endpoint label matches the
  final cumulative value, and the ceiling sits at the budget.
- **Failure test:** a project with no budget renders the view without a
  crash and without a fabricated ceiling.
- **Manual verification:** hover any week, in both themes, at 375px and
  at desktop.
- **Side-effect verification:** grep proves nothing under
  `app/(portal)` or `components/portal` imports the team hours query.
