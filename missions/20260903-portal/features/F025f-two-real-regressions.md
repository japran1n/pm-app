# F025f: Two real failures under the noise

**Milestone:** final remediation — **blocker**
**Estimated worker time:** 2 h
**Opened by:** the final full-suite run

The full suite reports 98 failures, of which 143 rate-limit errors
account for the overwhelming majority. Six are genuine, and two of those
are regressions.

## Regression 1 — a hidden phase comes back visible from a template

`project-from-template.test.ts` →
`test_AS_012_a_hidden_phases_client_visible_flag_survives_save_as_template_and_create_from_template`
fails.

F016h fixed exactly this in `20260917020000_create_project_from_template_phase_visibility.sql`.
The last migration to touch that function is
`20260927020000_f013_project_template_deliverables.sql`, which added
deliverables to the payload — and, on the evidence of this failure,
re-created the function without F016h's `client_visible` handling.

**This is the fourth time in this mission that a migration has silently
undone an earlier one**, after F016e's two reverts and F018 dropping two
values from `notifications_kind_check`. The shape is identical every
time: a migration re-creates a function or constraint to change one
thing, written from the author's mental model of what it contains rather
than from its current definition.

Worth noting how it survived: F013's worker ran "the tests relevant to
your change", and `project-from-template.test.ts` did not look relevant
to a feature about deliverables — even though the feature re-created
that test's subject. The instruction was followed correctly and the
result was still a regression that sat for a day.

## Regression 2 — F009b's AS-022 tests expect the old error code

Three failures in `f009b-close-second-approval-path.test.ts`, all
`expected '42501' to be 'P0001'`. F009d split the "no decision owner"
refusal out of the shared not-found oracle and gave it its own message,
which changed the code these tests assert.

Decide which is right rather than making the test match the code
reflexively: `42501` (insufficient_privilege) is arguably the more
honest code for an authorisation refusal, and F009d's own goal was to
stop this refusal reading as a generic failure. If the new code is
correct, update the tests **and** check that nothing in the application
branches on `P0001` for this path.

## The other four

`perf-budget` twice, at 529ms and 514ms against a 500ms budget, under a
481-file concurrent run. The M1 gate saw the same thing and the file
passed in isolation; confirm that is still true and leave it if so.

## Scope

1. Restore `client_visible` handling in `create_project_from_template`,
   forward-only, and check the same migration for anything else of
   F016h's or F015's it dropped.
2. Resolve the error-code mismatch, in whichever direction is right.
3. Re-run `perf-budget` in isolation and record the result.
4. **Then look for the same shape elsewhere:** every migration in this
   mission that re-creates a function or constraint another migration
   had already modified. Four have been found by accident. List what you
   checked, and say plainly whether you believe the list is complete and
   on what basis.

## Definition of done

- **Primary success test:** the template round-trip test passes, and a
  hidden phase stays hidden through save-as-template and create-from.
- **Failure test:** the three F009b tests pass against the intended
  code, and the reasoning for which code is correct is in the handoff.
- **Manual verification:** perf-budget in isolation.
- **Side-effect verification:** F013's, F016h's and F009d's suites pass.
