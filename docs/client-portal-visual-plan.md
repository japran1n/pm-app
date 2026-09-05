# Client portal — visual and experience plan

Written 2026-09-04, after measuring the rendered Overview against the data the
portal already holds.

The brief: the client experience is the product. More visual, more graphic,
using data we already have — and only extending the PM tool where the data
genuinely doesn't exist yet.

---

## Part 0 — What a client actually wants, in order

Everything below is judged against these five questions. A client opens the
portal to answer them, in this sequence, and leaves once they have.

1. **Are we on track?** One glance. Not a chart to read — an answer.
2. **What do you need from me?** Their obligations, with a way to act.
3. **What are you doing right now?** Proof of motion.
4. **When will it be done, and how sure are you?** A date plus a confidence.
5. **What changed since I last looked?**

Today's Overview answers 2 and 5 well, 3 partially, and buries 1 and 4 inside a
chart the client must decode. That is the core problem, and it is a layout
problem before it is a chart problem.

---

## Part 1 — "Where we are" is wrong right now (urgent)

Measured from the current render, not impressions.

### 1.1 A third of the chart is empty

The plot area runs to roughly 1900px while the last bar ends near 1290px. The
x-range extends far past the final phase, so the eye travels across a large
void to reach nothing. The range should end shortly after the last phase's end
date, not at an arbitrary rounded boundary.

### 1.2 The secondary line still truncates

`now: Hom…`, `now: Build …`, `not yet …` — the label column was widened, then
the content grew past it again. The in-flight task name and the blocked
qualifier are exactly the parts a client reads, and they are the parts cut.

### 1.3 Four facts run together as one string

```
Active · 28 Aug – 12 Sept · 3 of 5 done · now: Hom…
```

State, dates, count and current work, separated by middots, in one grey line.
Nothing is scannable; everything has equal weight. These are four different
kinds of fact and should not share one typographic treatment.

### 1.4 The bar shows state but not progress

`Visual direction & design` is `3 of 5 done`, and its bar is a solid block
identical in treatment to `Build` at `1 of 4`. The single strongest visual
channel on the page — bar fill — is carrying nothing. Progress should be drawn
inside the bar, so the picture and the number agree without reading.

### 1.5 The today line has no relationship to the phases

The dashed rule sits there, but nothing says whether a phase is **behind** it.
`Visual direction & design` runs to 12 Sept and is 3 of 5 done with today at
4 Sept — is that fine or late? The chart contains everything needed to answer
and says nothing.

### 1.6 The legend is redundant

Every row already prints its state as a coloured word (`Done`, `Active`,
`Blocked`, `Not started`). The legend below repeats the same four labels with
dots. It costs a row of vertical space and teaches nothing new.

### 1.7 Vertical air

Rows are roughly 56px tall carrying a 12px bar. Seven phases push the section
taller than it needs to be, in the one place whose job is the whole project at
a glance.

### What "Where we are" should become

- Range ends just past the last phase; no dead third.
- Two-line row: **name** on line one; on line two, dates and count as separate,
  differently-weighted spans — not a middot run-on.
- **In-flight work gets its own line** under active phases, not appended and
  truncated.
- Bar carries progress: filled portion = done fraction, remainder = the phase's
  own colour at low opacity, with a 2px surface gap between them.
- A phase whose elapsed share exceeds its done share while today is inside it
  gets a **slip marker** — a small tick at expected-progress — so behind reads
  as behind without a legend.
- Legend removed; state stays as the coloured word on each row.
- Row height down; bar height up. The bar should be the loudest thing in the row.

---

## Part 2 — Overview should answer, not index

Current Overview is a list of counts plus a chart. Proposed order, top to
bottom, matching the five questions:

### 2.1 The headline answer

One line, largest type on the page: **on track / at risk / late**, the launch
date, and the confidence — from `target_launch_date` and `launch_confidence`,
which now have an editor. Beside it, one sentence of context from `launch_note`.

This replaces the small `LAUNCH 4 OCT 2026 · ON TRACK` chip in the header,
which is currently the only place the most important fact appears.

### 2.2 "What we need from you" — first, not fourth

Today `Waiting on you 5` is one tile among four. It should be a block: each item
named, aged ("asked 3 days ago"), with its action inline. A client who does
their part in the first ten seconds is the entire point of a portal.

The union query for that count already exists (F085). The items behind it do not
need new data — approvals, pending-approval tasks and past-due deliverables are
all already read.

### 2.3 The strip of four tiles becomes four **sparkline** tiles

The tiles show a number and a caption. Each has history available and shows none:

| Tile | Add |
|---|---|
| Hours used | the burn-down sparkline already computed for the Hours view |
| Pages ready | a small stacked bar of the status distribution |
| Waiting on you | the count only — a sparkline here would be noise |
| Days to launch | a slip indicator if the date has moved |

A number with its trend behind it answers "and is that good?" without a click.

### 2.4 "Where we are" (fixed per Part 1)

### 2.5 What changed since your last visit

Exists. Keep, but give each entry a type icon so the list is scannable.

---

## Part 3 — Visuals to add, all from data we already hold

Counted on Website Redesign today: 7 phases, 4 approvals, 5 deliverables,
4 metrics, 1 budget, 4 scope items, 2 change requests, 2 decisions,
2 assumptions, 4 links, 4 accounts, 22 tasks, 12 time entries.

### 3.1 Metrics as bullet charts (Results)

Four metrics with baseline, current and target, currently rendered as
before/now/target text plus a comparison card. A **bullet chart** is the exact
form for this shape: a target as a tick, the current value as a bar, the
baseline as a lighter range behind it. One row per metric, all on one scale per
metric, direction honoured so a "lower is better" metric reads correctly.

This is the single biggest visual upgrade available from existing data.

### 3.2 The page journey as a pipeline (Pages)

`status-label.ts` already defines the seven-step journey and the client buckets.
Today it is a distribution bar plus a table. A **pipeline** — steps left to
right, count per step, with the client's own bucket highlighted — turns "where
are my pages" into one picture. The seven-step explainer already written for
this view becomes the axis instead of a paragraph.

### 3.3 Budget as one honest figure (Hours + Overview)

The burn-down exists and is good. What is missing on Overview is the one-glance
version: a single horizontal bar, used vs sold, with the ceiling marked and
overage drawn past it in the blocked token when negative. The over-budget case
now has real numbers (F085) and deserves a picture.

### 3.4 Deliverable states as a strip (Your list)

Five deliverables across requested / delivered / accepted / waived / overdue.
A small segmented strip above the list gives the shape before the detail, using
Your-list vocabulary (fixed in F085), not the Pages words.

### 3.5 Approval ageing (Approvals)

`requestedAt` and `round` are now surfaced as text. A tiny horizontal age bar
per open approval — days waited, with the due date marked — makes "this one has
been sitting" visible without arithmetic.

### 3.6 Weekly delivery rhythm (Overview)

From task completion dates: a small bar per week showing how much shipped. This
is the most persuasive chart a client can see, because it is evidence of steady
motion rather than a claim of it. Data exists in `tasks` and `task_activity`.

---

## Part 4 — Where the PM tool needs work first

Everything above is presentation of existing data, with three exceptions.

1. **A blocked phase has no reason field.** The timeline renders `Blocked` in
   the strongest colour on the page with nothing saying what blocks it. Needs a
   `blocked_reason` (or a link to the blocking deliverable/approval) on
   `project_phases`, plus an editor in project settings.
2. **Phase progress uses client-visible task counts only.** That is honest, but
   a phase can be 80% done in effort and 1-of-4 in count. Worth deciding whether
   the client should see count or weighted progress; count is defensible and
   cheaper — the decision should be explicit rather than incidental.
3. **`launch_confidence` has no history.** A confidence that silently changed
   from `on_track` to `at_risk` is exactly what a client wants flagged in "what
   changed". Needs a small history table or an audit read.

---

## Part 5 — One real defect found while planning

The dark-mode status palette fails the colour validator's lightness band:

```
[FAIL] Lightness band  outside band: #7aa5f3 (0.723), #dbb03e (0.776)
```

Separation, chroma and contrast all pass; only the lightness band fails, and
narrowly. Light mode passes every check. Worth re-stepping the two dark values
before adding charts that lean harder on those colours than the current UI does.

---

## Order of work

1. **"Where we are"** — Part 1, all seven points. Urgent, and it is the section
   the client looks at first.
2. **Overview reorder** — 2.1, 2.2, then 2.3.
3. **Bullet charts for metrics** — 3.1. Highest value per hour of the rest.
4. **Pipeline for pages**, **budget bar**, **deliverable strip** — 3.2–3.4.
5. **Approval ageing**, **weekly rhythm** — 3.5, 3.6.
6. **Blocked reason** — Part 4.1, the only one that blocks a visual.
7. Dark palette re-step — Part 5.

Every chart follows the `dataviz` rules already validated for this codebase:
one scale, thin marks, theme tokens for chart text, no colour-only encoding,
legend only where two or more series exist, and a hover layer by default.
