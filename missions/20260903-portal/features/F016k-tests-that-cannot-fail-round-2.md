# F016k: Three more tests that cannot fail, and one state nothing can reach

**Milestone:** M3 remediation — final
**Estimated worker time:** 1.5 h
**Opened by:** the M3 third gate

## The items

1. **AS-003's agreement test is a tautology.** The badge still
   re-expresses the past-due predicate as PostgREST filters instead of
   calling `isDeliverablePastDue`, and the test that claims badge and
   view agree compares that function to itself through `classifyBucket`.
   It cannot fail. Make the badge call the shared function, and make the
   test compare the two real surfaces.

2. **Only one of the three `swept_at` clearing branches is tested.**
   Deleting the accept/waive line keeps the suite green. Cover all
   three events the trigger claims to handle.

3. **Nothing in the product ever writes `state = 'waived'`.** The
   enum value, the trigger branch and the UI copy all exist for a state
   no code path can produce. Either give it the action it implies — a
   team member waiving an obligation they have decided not to chase,
   which is a real thing a PM does — or remove it. Decide, and say
   which in the handoff. Do not leave a dead branch that future readers
   must reason about.

4. **F016f's revert guard is a source-text grep.** It passes if the
   `client_gate` call is commented out or its flags neutered. Make it
   behavioural: assert the function actually refuses a caller the gate
   should refuse. The whole point of that guard was to catch a silent
   revert, and a grep catches only a deletion.

## Assertion IDs covered
- AS-003, AS-030

## Definition of done

- **Primary success test:** the badge and the view are proven to agree
  by a test that reads both, and it fails when either is changed alone.
- **Failure tests:** each of the three clearing events has a test that
  fails when its branch is removed; the client_gate guard fails when the
  gate call is neutered rather than deleted.
- **Manual verification:** `waived` is either reachable from the UI or
  gone from the schema, the trigger and the copy.
- **Side-effect verification:** M3's suites pass.
