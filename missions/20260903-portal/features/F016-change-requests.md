# F016: Change requests — triage, quote, and the gate

**Milestone:** M3
**Estimated worker time:** 3 h
**Depends on:** F012, F015; reuses F007's decision mechanism

## Assertion IDs covered
- AS-047: A client request classified as a change request cannot become a task until the client has approved its quote, enforced inside the database function rather than in the UI.
- AS-048: The portal shows each change request with its estimate, price, and current state.

## What exists

`client_requests` (`20260902030000`), `accept_client_request_atomic`
(`20260905100000`), the components in `components/client-requests/`, the
portal's `new-request-form.tsx` and `request-list.tsx`, and a realtime
publication (`20260905120000`). This feature extends all of it rather
than starting a parallel concept.

## Scope

### 1. Columns

```
kind             text not null default 'change'
                 check (kind in ('bug','change','new_work','question'))
severity         text null check (severity in ('blocker','major','minor'))
scope_verdict    text null check (scope_verdict in ('in_scope','change_request','warranty'))
quoted_hours     numeric null check (quoted_hours > 0)
quoted_amount    numeric null check (quoted_amount >= 0)
quote_currency   text null
quote_note       text null
quote_valid_until date null
client_decision  text not null default 'pending'
                 check (client_decision in ('pending','approved','rejected'))
decided_by       uuid null references auth.users(id)
decided_at       timestamptz null
track            text null check (track in ('design_change','dev_change','content_seo'))
```

Existing rows get `kind = 'change'`, `client_decision = 'pending'` and
null verdicts — and must keep working. Anything already accepted stays
accepted; this migration does not retroactively gate history.

### 2. The gate

Harden `accept_client_request_atomic`: when `scope_verdict =
'change_request'`, refuse unless `client_decision = 'approved'`, with a
distinct error code the UI can render. **In the function** — AS-047 is
explicit that a UI-only check does not satisfy it.

Also refuse when `quote_valid_until` has passed: an expired quote needs
a fresh one, not a silent acceptance at a stale price.

### 3. Triage

`/w/[workspaceSlug]/requests` gains a triage flow: verdict in one of
three buttons, then, for a change request, a quote form (hours, amount,
currency, validity, note). Default the amount from a workspace hourly
rate if one exists, and let it be overridden — do not invent a rate
setting if none exists; read it from the workspace settings that are
already there, and if there is none, leave the field manual and say so
in the handoff.

Before sending, show **"how the client will see this"**. A price the
client reads differently from what the PM meant is the single most
expensive misunderstanding in this whole system.

### 4. Client decision

Reuse F007's `approval_requests` with `decision_type = 'commercial'`,
subject `artifact`, pointing at the request. The client approves a quote
through exactly the same mechanism as everything else, and it lands in
the same decision history. Do not build a second decision path.

On approval: `client_decision = 'approved'`, then the existing accept
flow may run, and a `project_scope_items` row is added with
`source = 'change_request'` (F012) so the scope list stays truthful.

### 5. Track

The three-question decision rule from the process picks the track, which
in turn decides which QA steps the resulting task gets:
design_change → dev QA + design QA · dev_change → dev QA ·
content_seo → requester confirms.

Ask the three questions in the triage UI, propose the track, let the
team override, and log the override. The rule is a good default and a
bad master.

### 6. Portal

The Scope view's change-request table fills in: estimate, price, state
("Awaiting your approval", "Approved 21 Oct", "Declined 18 Sep"), and a
link into the approval when one is open.

## Definition of done

- **Primary success test:** integration — a `change_request` with
  `client_decision = 'pending'` cannot be accepted; after the client
  approves through the approval RPC, it can, and a scope item appears.
- **Failure tests:** (a) accepting an expired quote is refused; (b)
  pre-existing accepted requests are unaffected by the migration.
- **Manual verification:** the "how the client sees this" preview
  matches the portal exactly.
- **Side-effect verification:** the existing request list, new-request
  form and realtime publication all still work.
