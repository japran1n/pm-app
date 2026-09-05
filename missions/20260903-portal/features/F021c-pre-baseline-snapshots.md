# F021c: A measurement from before the baseline is shown as an improvement

**Milestone:** M4 remediation — **blocker**
**Estimated worker time:** 1.5 h
**Opened by:** the M4 gate, orchestrator-verified

## The defect

`lib/queries/metrics.ts:207-243` compares the latest snapshot to the
baseline without ever comparing `measured_at` to `baseline_at`.
Verified: zero references to the baseline date in that function. Its own
comment says "no **post-baseline** snapshot", and its parameter type
(`Pick<ProjectMetric, "baselineValue" | "direction">`) does not even
carry the field the comment describes.

So a metric baselined 2026-03-01 with one snapshot from 2026-01-15
renders "Improved", in green, from a measurement taken before the work
started.

The AS-041 test calls that helper with hand-built arguments that omit
the very field the assertion turns on. It cannot fail for AS-041's
reason — the sixth test in this mission found to be incapable of failing
for the thing it names.

## Also in scope, from the same gate

- The threshold sweep's `update notifications set project_id` sits
  **outside** its per-row exception block, and is exactly where the
  partial unique index raises a duplicate — so one project can still
  abort the whole run, which is the failure mode F018 was written to
  avoid.
- The sweep is silent for a project with no lead. Decide: notify someone
  else, or record that the project has nobody to notify. Silence is the
  one option that hides the problem.
- `results/page.tsx:76` renders a query failure as "nothing measured
  yet". That is F006f's defect class — a failure presented as a
  reassuring fact — in the one view whose entire purpose is credibility.

## Definition of done

- **Primary success test:** a metric whose only snapshot predates its
  baseline renders as not yet measured, not as an improvement.
- **Failure test:** the AS-041 test fails when the date comparison is
  removed — demonstrated, then reverted.
- **Manual verification:** the sweep completes when one project raises;
  a failed metrics query does not read as "nothing measured yet".
- **Side-effect verification:** F018's, F020's and F021's suites pass.
