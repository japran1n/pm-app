# F021: Portal — Results view

**Milestone:** M4
**Estimated worker time:** 2 h
**Depends on:** F020

## Assertion IDs covered
- AS-041: A metric with no post-baseline snapshot is presented as not yet measured rather than as an improvement.
- AS-042: The portal Results view renders each metric as a before/after comparison against its target.

## Scope

Replaces the stub at `p/[projectId]/results/page.tsx`.

### 1. Metric cards

One card per client-visible metric: name, then a small paired-bar SVG —
**Before** in muted ink, **Now** in the done token — with the target as
a dashed vertical tick and its value labelled beneath.

Two grounded bars beat a single arrow: the distance between them is the
whole message, and an arrow hides it.

`direction` (F020) decides whether "Now" is drawn as an improvement:
for a `lower` metric a smaller bar is better, and the done token belongs
on it only when it actually beat the baseline. A metric that got worse
is drawn in the blocked token and labelled as such. Hiding a regression
in a client portal is the fastest way to lose the client who later finds
it themselves.

### 2. Not yet measured

A metric with no snapshot renders "Before" and, in place of "Now", the
line "not measured yet" plus when it will be — never a zero bar, never
an em dash pretending to be a value.

### 3. Improvements

The before/after list: area, explanation, and the two images side by
side where they exist. Where they do not, the explanation stands alone —
this section must not require images to be worth reading.

### 4. Header

One line saying when the baseline was frozen and that the same method
will be used again. That sentence is what makes the numbers credible.

## Definition of done

- **Primary success test:** unit — a metric with `direction = 'lower'`
  and a lower "Now" renders as an improvement; the same numbers with
  `direction = 'higher'` render as a regression.
- **Failure test:** a metric with no snapshot renders the not-measured
  treatment and no bar.
- **Manual verification:** both themes; the target tick sits at the
  right position on the scale for every card.
- **Side-effect verification:** no fabricated value anywhere on the page.
