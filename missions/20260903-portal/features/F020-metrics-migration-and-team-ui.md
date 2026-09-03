# F020: Metrics and improvements — migration and team UI

**Milestone:** M4
**Estimated worker time:** 3 h
**Depends on:** F001

## Assertion IDs covered
- AS-039: A project can record baseline metrics with a value, a unit, a target, and a measurement source.
- AS-040: Once a project's baseline is frozen, its baseline values can no longer be changed; later measurements are recorded as separate snapshots.
- AS-041: A metric with no post-baseline snapshot is presented as not yet measured rather than as an improvement.

## Scope

### 1. `project_metrics`

```
id, project_id,
name text not null, unit text null,
source text not null check (source in ('gsc','ga4','lighthouse','crux','manual','other')),
baseline_value numeric null, baseline_at date null,
target_value numeric null,
direction text not null default 'higher' check (direction in ('higher','lower')),
display_max numeric null,          -- the scale the portal draws against
client_visible boolean not null default true,
position integer not null, created_at / updated_at
```

`direction` matters: for LCP lower is better, for sessions higher is.
A chart that treats every metric as "up is good" tells the client the
opposite of the truth on half the rows.

### 2. `metric_snapshots`

```
id, metric_id references project_metrics on delete cascade,
value numeric not null, measured_at date not null,
note text null, created_by uuid not null, created_at
```

### 3. Freezing

`projects.baseline_frozen_at timestamptz null`. Once set, a trigger
rejects any UPDATE to `baseline_value` or `baseline_at` on that
project's metrics. Post-freeze measurement is a snapshot, always.

This is the mechanical form of the process rule that the metric list is
fixed in Phase 1 and re-measured identically afterwards. Without the
trigger, a well-meaning edit six weeks later quietly destroys the only
before/after the agency has.

### 4. `project_improvements`

```
id, project_id, area text not null, explanation text not null,
before_path text null, after_path text null,   -- storage paths
position integer not null, client_visible boolean not null default true
```

Images through the existing attachments bucket and policies.

### 5. Team UI

A "Measurement" panel in the project: metric rows with baseline, target,
direction and source; a "Freeze baseline" action with a confirmation
that says plainly what becomes immutable; snapshot entry per metric; and
the improvements list with before/after uploads.

### 6. Phase exit check

When phase 2 ("Audit & baseline") is moved to `done` and the project has
no frozen baseline, warn — do not block. The process says the baseline
is that phase's exit criterion; the tool should say so and then respect
the human's decision.

### 7. Not in scope

Automatic collection from GSC / GA4 / Lighthouse. Manual entry is v1, as
the plan documents state. Do not add an API client "while we are here".

## Definition of done

- **Primary success test:** integration — after freezing, an update to
  `baseline_value` is rejected by the database; a snapshot insert
  succeeds.
- **Failure test:** a metric with `client_visible = false` is absent
  from portal queries, including any aggregate.
- **Manual verification:** the freeze confirmation names exactly what
  becomes immutable; the phase-2 warning appears and does not block.
- **Side-effect verification:** `db:apply`, `db:gen-types`, `tsc`, eslint.
