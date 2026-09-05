# F025b: The client can read a price we have not sent them

**Milestone:** M5 remediation
**Estimated worker time:** 1.5 h
**Opened by:** F025's leak sweep, which found it on its first real run

## The defect

`client_requests.quoted_amount` has no read-side gate separating a quote
the team has priced **internally** from one that has actually been
delivered through the approval flow. A row with
`scope_verdict = 'change_request'`, `client_decision = 'pending'` and no
`approval_request_id` is a price the PM is still thinking about — and
the client can read it.

This matters more than most leaks in this mission because it is
commercial rather than operational. A client who sees a number before
the PM has decided to send it will anchor on it, and the PM will have
lost the negotiation before opening it. F016's own spec called this out:
*"a price the client reads differently from what the PM meant is the
single most expensive misunderstanding this system can produce."*

It is also worth noting how it was found. F025's route walk planted a
value in a field nobody had thought to check, and the payload assertion
caught it. That is the exact shape the sweep was built for, and it paid
for itself on the first run.

## Assertion IDs covered
- AS-055: A client session that walks every portal route returns no internal-only field in any response payload.

## Scope

1. Decide what "sent" means and make it explicit in the data rather than
   inferred. An `approval_request_id` being present is the current de
   facto signal; a `quote_sent_at` timestamp written by
   `send_change_request_quote_atomic` would be clearer and testable.
   Pick one, and say why in the handoff.
2. Gate the client's read of `quoted_hours`, `quoted_amount`,
   `quote_note` and `quote_valid_until` on that signal — in RLS or in
   the query, following whatever this mission's other client reads do.
   Prefer the policy.
3. The team's view is unaffected: a PM must still see the draft price.
4. Extend F025's sweep so this specific shape stays covered, and confirm
   the sweep fails if the gate is removed.

## Definition of done

- **Primary success test:** a client cannot read the quote fields of a
  priced-but-unsent change request, through any portal route or a direct
  PostgREST call.
- **Failure test:** once sent, the client sees the quote; the team sees
  it throughout.
- **Manual verification:** F025's sweep fails when the gate is reverted.
- **Side-effect verification:** F016's, F016f's and F016j's suites pass.
