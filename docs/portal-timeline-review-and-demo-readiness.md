# Overview → "Where we are": review, improvements, and demo readiness

Written 2026-09-04, after reviewing the rendered timeline against
`components/portal/phase-timeline.tsx` and `lib/queries/portal.ts`.

---

## Part 1 — Is the timeline correct?

**No. There is one real defect, one contradiction, and one semantic gap.**
The chart geometry itself is sound; the data feeding it is not.

### 1.1 Every phase reads 0% — including the ones marked Done

This is the headline problem and it is a **seed-data defect, not a chart
bug**. `lib/queries/portal.ts:418` computes progress as
`done / total` over the tasks whose `phase_id` matches the phase:

```
for (const task of tasks ?? []) {
  if (!task.phase_id) continue;      // ← every task takes this branch
  ...
}
```

`tasks.phase_id` exists (added by
`supabase/migrations/20260909010000_portal_foundations.sql:72`), but
`scripts/seed-demo.mjs` sets `phase_id` on exactly two things —
`approval_requests` and `client_deliverables` — and **never on a task**.
So every phase has zero tasks, every phase divides to 0%, and the
number carries no information anywhere on the page.

The query is behaving exactly as written. The demo data is incomplete.

### 1.2 "Done · 0%" is self-contradictory, and would be even with correct data

A phase with no client-visible tasks should not print a percentage at
all. `progressPercent` deliberately returns 0 for an empty phase, and
the comment at `lib/queries/portal.ts:416` says the distinction is
"stated as such by the UI" — but the UI doesn't state it, it just
renders `0%` (`phase-timeline.tsx:275`).

The consequence is the worst kind of wrong: a client sees a finished
phase labelled zero percent complete and concludes either that we
can't count, or that "Done" doesn't mean done. Both are worse than
showing nothing.

`totalClientVisibleTasks` is already returned. The fix is to branch on
it: show `Done` alone when there is nothing to count, `Done · 8 of 8`
when there is. A count beats a percentage here anyway — "6 of 9" tells
a client more than "67%", and it exposes the denominator, which a
percentage hides.

### 1.3 A phase can be "Blocked" before it has started

`6000. QA & accessibility` is drawn Blocked, in red, scheduled entirely
in the future (11–25 Sept). Nothing in the UI says *what* blocks it or
*who* clears it. Red is the strongest signal on the page and it is
currently spent on a phase nobody has begun.

Either blocked-before-start should be disallowed, or the timeline must
name the blocker inline. My recommendation is the second: a blocked
phase without a stated reason is an alarm with no instruction.

---

## Part 2 — Timeline: UI/UX improvements

Ordered by how much they change the client's understanding, not by
effort.

### 2.1 Replace the percentage with a count, and give each phase its dates

Right now a row carries: name, state, percentage. No dates. A client
reading it statically cannot tell when a phase runs — that information
exists only on hover, which is invisible on a screenshot, on a phone,
and to anyone the client forwards this to.

Row should read: `4000. Visual direction · Active · 28 Aug – 11 Sept ·
4 of 7 done`.

### 2.2 Fix the axis: "Today" is a marker, not a tick

The axis currently reads `14 Aug · 28 Aug · Today · 11 Sept · 25 Sept`.
`Today` is injected into an otherwise even fortnightly rhythm, which
breaks the spacing and makes the axis read as if the interval between
28 Aug and 11 Sept is somehow different. The dashed rule already marks
today perfectly well; the word belongs on that rule, not in the tick
sequence.

### 2.3 One state, one colour

Bars are drawn in very pale tints; the legend dots below them are fully
saturated. The same four states are encoded twice, in two different
intensities, which reads as two different scales. Either lift the bars
or calm the legend — but they must match, or the legend is teaching a
key that the chart does not use.

### 2.4 Don't truncate the thing the row is named after

`4000. Visual direction &…` — the label column is fixed-width and the
name loses its second half. Phase names are short and finite; give the
column its natural width, or wrap to two lines. A truncated label is a
row you cannot identify.

### 2.5 Drop the internal numbering, or explain it

`1000 / 2000 / 3000` is our internal phase numbering. To a client it
reads as a code they're expected to know. Either use plain ordinals
(`Phase 4 of 7`) or drop the prefix entirely — the row order already
carries the sequence.

### 2.6 Tighten the vertical rhythm

Each phase occupies a tall row for a thin bar. Seven phases already
push the chart past a laptop fold. Reducing row height brings the whole
project into one glance, which is the entire point of this section.

### 2.7 Say what is happening *now* inside the active phases

Two phases are Active. The client learns that they are active and
nothing else. The single most valuable line on this page would be, under
each active phase, the one thing currently in flight — which the app
already knows.

---

## Part 3 — Feature ideas beyond the timeline

- **"What we need from you" pinned to the top of Overview.** The client's
  own blockers, ahead of our progress. It is the one section that
  changes their behaviour rather than informing them.
- **Expected vs actual, drawn honestly.** Planned bars behind actual bars
  in the same row, so slippage is visible rather than silently rebased.
- **A dated changelog per phase.** "What changed since your last visit"
  exists; a per-phase history answers "when did this move" without
  asking us.
- **Phase-level ETA with a stated confidence.** A date with no confidence
  is a promise; a date with one is a forecast.
- **Client-visible risk register.** The risk banner is binary today; a
  short list with owners is what a client actually escalates from.
- **Export the timeline to PDF.** Clients forward status to their own
  stakeholders. Today they screenshot it.

---

## Part 4 — Demo readiness for the team presentation

Four gaps between what exists and what a presentation needs.

### 4.1 Accounts

`scripts/seed-demo.mjs` already creates six accounts on `demo.test`
covering every role — owner, admin, two members, viewer, client — all
with password `Demo1234!`. **This part is done**, provided everyone
demoing knows the Password tab exists on `/sign-in`.

What is missing is a second client account, so that "this client sees
their project and not the other one" can be *shown* rather than
asserted.

### 4.2 Workspace switching has nothing to switch between

`components/workspace-switcher.tsx` exists and is wired into the
sidebar, but the seed creates exactly one workspace (`Acme Studio`). The
switcher is therefore a control that visibly does nothing — the worst
thing to hit live in front of an audience.

Needs a second workspace with its own projects, members and branding, and
at least one account that belongs to both.

### 4.3 Projects that exercise every feature

Four projects exist, but only "Website Redesign" has portal data, and
none of them have tasks linked to phases (see 1.1). For a demo the set
should deliberately cover the states nobody remembers to build:

- a project mid-flight with a **healthy** burn-down
- a project **over budget**, so the red path is real
- a project with an **overdue** approval and an overdue deliverable
- a **finished / launched** project, so "what does done look like" has an answer
- an **archived** project, so the archive isn't an empty screen
- a project with the portal **off**, so the switch demonstrably matters

### 4.4 A written demo script

Not a document for the team — a route through the app that hits every
feature in an order that tells a story, with the account to use at each
step. Without it, a live demo discovers its own gaps in front of the
audience.

---

## Suggested order of work

1. **Link tasks to phases in the seed** — unblocks the entire timeline.
2. **Fix `Done · 0%`** — count instead of percentage, nothing when there's
   nothing to count.
3. **Dates on each row; fix the axis; fix the truncated label.**
4. **Second workspace + second client + the six demo projects.**
5. **Blocked-phase reason, and the "now in flight" line.**
6. **Demo script.**

Items 1–3 are defects and should land regardless of what is decided
about the rest.
