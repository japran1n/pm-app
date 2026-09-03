# F018: Team UI — budget, work category, and the team burn view

**Milestone:** M4
**Estimated worker time:** 2 h
**Depends on:** F017

## Assertion IDs covered
- AS-033: A project can record a budget of sold hours for a period.
- AS-038: The portal shows hours broken down by work category, and every category shown has a stated value.

## Scope

### 1. Budget setup

In project settings: period, sold hours, optional rate and currency,
rollover policy. Show what is already spent in the current period beside
the field, so the number is entered with context rather than blind.

### 2. Work category on the entry

`components/task/time-tracking.tsx` gains a category select, defaulted
from the task's type. Existing entries keep their null and are editable
in place from the team hours view — do not force a migration wizard.

### 3. Team hours view

`/w/[slug]/projects/[id]/hours` — the full picture: by person, by
category, billable and not, with the client-visible subset marked so a
PM can see exactly what the client sees without switching context.

### 4. Thresholds

At 80% and 100% of the period's sold hours, write a notification to the
project's PM through the existing `create_notification()` RPC. A daily
pg_cron sweep, idempotent — one notification per project per threshold
per period, never a daily repeat.

This is the one place where the missing email hurts least: an in-app
notification about your own project's budget is checked, because the PM
is in the app anyway.

## Definition of done

- **Primary success test:** integration — the sweep writes exactly one
  notification per threshold per period, and nothing on a second run.
- **Failure test:** a `viewer` and a `client` cannot create or edit a
  budget.
- **Manual verification:** the category select defaults sensibly from
  the task type and can be overridden.
- **Side-effect verification:** the existing time-tracking component
  still logs entries with no category chosen.
