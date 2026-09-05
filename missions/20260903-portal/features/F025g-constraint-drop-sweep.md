# F025g: The half of the sweep F025f could not honestly claim

**Milestone:** final remediation
**Estimated worker time:** 1.5 h
**Opened by:** F025f's own statement of what it did not cover

## Why this exists

F025f swept every function this mission's migrations re-created, by
mechanical grep rather than by recall, and pairwise-diffed each
re-creation. It then said plainly that it did **not** apply the same
rigour to constraints — no parallel list of every `alter table … add /
drop constraint` and `create table … check (…)`, no pairwise diff — and
flagged that as the honest gap rather than asserting a completeness it
could not back.

That gap is not hypothetical. The one known instance of this class on
the constraint side is F018 dropping two values from
`notifications_kind_check`, which made AS-023 false for a day: every
Approve click rolled the whole decision back, and three scrutiny rounds
ran in that window without catching it. It surfaced from a side-effect
test in an unrelated feature.

So the function half is swept and the constraint half is not, and the
constraint half is where the worst instance actually happened.

## Scope

1. Build the mechanical list — every `alter table … add constraint`,
   `alter table … drop constraint`, and `create table … check (…)` in
   the migrations this mission added. By command, not by reading.
2. Group by table plus constraint name and pairwise-diff each group's
   history, exactly as F025f did for functions: any removed value or
   clause that is not a documented, intentional change in the newer
   migration's own header is a finding.
3. Verify F018's own fix is still correct today rather than assuming it
   — F025f explicitly did not re-check it.
4. Widen once beyond this mission's own migrations for the specific case
   of constraints that this mission's migrations *modified* but did not
   create: if we re-created someone else's constraint, the same question
   applies.
5. Fix what you find, forward-only. If you find nothing, say so and say
   what you checked — a clean result stated with its basis is worth more
   than a fix.

## Definition of done

- **Primary success test:** any constraint value dropped by this
  mission's migrations is restored, or shown to have been intentional.
- **Failure test:** n/a unless you find something; if you do, the test
  that would have caught it goes in with the fix.
- **Manual verification:** the enumeration is in the handoff, produced
  by a command that is quoted there.
- **Side-effect verification:** the suites for whatever you touch.
