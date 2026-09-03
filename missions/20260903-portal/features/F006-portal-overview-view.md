# F006: Portal — Overview view and phase timeline

**Milestone:** M1
**Estimated worker time:** 3 h
**Depends on:** F001 (phases), F003 (shell), F004 (tokens), F005 (page counts)

## Assertion IDs covered
- AS-002: The sidebar shows a numeric badge on Approvals equal to the number of approval requests currently awaiting this client's decision.
- AS-003: The sidebar shows a numeric badge on Your list equal to the number of the client's deliverables that are past their due date.
- AS-010: The portal renders a phase timeline that shows more than one phase in the active state simultaneously when more than one phase is active.
- AS-031: A blocking deliverable that is past its due date is surfaced on the portal overview, not only inside its own view.

## Scope

The prototype's overview, in this order down the page.

### 1. Risk banner

Renders only when something is genuinely wrong: a blocking deliverable
past due (M3) or an approval open longer than the project's threshold.
Until F012 lands there is nothing to feed it, so the component ships
now, renders nothing, and is wired in M3. **It must not render a
placeholder.**

### 2. Four tiles

Waiting on you · Pages ready · Hours used · Days to launch.

`components/portal/overview-tiles.tsx`, one shared tile primitive so the
four are identical objects (same padding, same baseline, same foot
line). Hours is not available until M4: render an em dash and the foot
line "Available with the next release" — never a fabricated number.

### 3. Phase timeline

`components/portal/phase-timeline.tsx` — inline SVG, no chart library.

- One row per client-visible phase: number, name, a bar spanning its
  planned dates, progress fill inside the bar.
- The x-axis is weeks derived from the earliest planned start to the
  latest planned end across the project's phases; label every other
  week.
- A dashed "today" rule with a label.
- Bar colour from the F004 status tokens by phase state; not-started
  phases are muted.
- Hover a bar → tooltip with the phase name, progress and its note.
  One tooltip element for the whole chart.
- Legend beneath naming all four states.
- The chart scrolls horizontally inside its own container; the page body
  never scrolls sideways.
- Phases with no planned dates fall back to equal-width slots in
  position order rather than collapsing to zero width.

Accessibility: `role="img"` with an `aria-label` summarising where the
project is, and every label taking its colour from a theme token.

### 4. Waiting-on-you strip

Reuse `PortalOverviewLive`'s existing realtime plumbing. Until F009
lands, it shows tasks flagged `pending_client_approval` as it does
today; F009 replaces the source with `approval_requests` without
touching this component's shape.

### 5. Since your last visit

The existing `getPortalActivitySummary` output, rendered as the
prototype's row list with links into the relevant views instead of the
current single sentence.

### 6. Right rail

- Live now — from `active_timers`; a task name only when the task is
  client-visible, otherwise the phase name. Never a duration.
- Hours card — placeholder until M4 (same honest treatment as the tile).
- Your team — `project_members` with avatar, name and role label.

## Files (approximate)

- `app/(portal)/portal/[workspaceSlug]/p/[projectId]/overview/page.tsx`
- `components/portal/{phase-timeline,overview-tiles,risk-banner,live-now,team-card}.tsx` (new)
- `lib/queries/portal.ts`

## Definition of done

- **Primary success test:** unit test — a project with two phases in
  `active` renders both as active; a phase with `client_visible = false`
  renders neither a row nor a contribution to any tile.
- **Failure test:** a project with no phases renders the rest of the
  overview without the timeline and without an error.
- **Manual verification:** the timeline reads correctly in both themes
  at desktop and at 375px; the today rule sits where it should.
- **Side-effect verification:** no fabricated figure anywhere on the
  page; the hours tile visibly says the data is not available yet.
