# F006g: One source of truth for what a status means to a client

**Milestone:** M1 remediation, round 2
**Estimated worker time:** 2 h
**Depends on:** F004, F005
**Opened by:** the M1 re-scrutiny

## The defects

1. **A `not_started` status is reported to the client as "Waiting on
   you"** (`components/portal/status-label.ts:44-48`,
   `status-distribution.tsx:28`). A Backlog page nobody has started
   yet tells the client the work is blocked on them. It also appears in
   the Pages distribution's "Waiting on you" while appearing nowhere in
   the Overview's list of the same name — two screens, two answers.

   This is the most client-damaging defect left in M1: it blames the
   client for our own backlog.

2. **`clientStatusLabel` (`status-label.ts:8-16`) resolves a
   client-facing phrase with `/review/i` against the status name** — in
   the module F004 designated as the single home for this concept, and
   using exactly the name-matching approach F004 was forbidden to use.

3. **The bucket→label map is triplicated** across `pages-table.tsx:39-44`,
   `status-distribution.tsx:27-32` and `status-manager.tsx:81-87`, and
   the third copy has already diverged. Three copies of a mapping is
   three answers to the same question.

4. A task with `status_id = null` renders a coloured pill with an empty
   label.

## Assertion IDs covered
- AS-015: Each page row shows the same status the team sees, with no second mapping that can diverge.
- AS-017: The Pages view shows a distribution bar summarising how many pages are waiting on the client, in progress, blocked, and ready to launch, with each count also stated in text.

## Scope

1. **`not_started` maps to its own bucket, not to waiting.** The four
   buckets stay four; `not_started` belongs with in-progress work as
   "not started yet" or with done as neither — decide, and make the
   Overview's waiting list and the Pages distribution agree by
   construction. Only `pending_client_approval` / an open approval /
   an explicit `client_bucket = 'waiting'` may put a row in "Waiting on
   you". If the four buckets genuinely cannot express this, add a fifth
   and say why in the handoff — do not overload waiting.
2. **Delete the `/review/i` regex.** The bucket comes from
   `client_bucket` with a category-derived fallback, as F004 specified.
   No status is ever recognised by its name.
3. **One exported map**, in `status-label.ts`, imported by all three
   consumers. Delete the other two copies.
4. **A null `status_id`** renders a neutral pill reading "No status",
   not an empty coloured one.
5. One test asserting the Overview's waiting count and the Pages
   distribution's waiting count agree for the same project — the bug
   this feature exists to make impossible.

## Definition of done

- **Primary success test:** a project with a Backlog page shows it as
  not started in the distribution, and it does not appear in "Waiting
  on you" on either screen.
- **Failure test:** a status named "Design review" with no
  `client_bucket` is not classified as waiting by its name.
- **Manual verification:** `grep -rn "review" components/portal/` shows
  no name matching; the bucket→label map exists in exactly one file.
- **Side-effect verification:** F004 and F005 tests pass, updated where
  they asserted the old mapping.
