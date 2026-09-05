# F016g: Anyone with the publishable key can run our cron job

**Milestone:** M3 remediation — **blocker, and I deferred this once already**
**Estimated worker time:** 3 h
**Opened by:** the M3 re-scrutiny

## The defect

`revoke all on function … from public` does **not** remove Supabase's
default per-role grants. `pg_default_acl` for functions in this project
is `{postgres=X, anon=X, authenticated=X, service_role=X}`, so every
function created here is executable by `anon` and `authenticated`
regardless of what its own migration revokes.

Two functions make that immediately dangerous:

- **`sweep_overdue_blocking_deliverables`** (M3's own) — SECURITY
  DEFINER, zero authorisation, callable at `/rpc/` by anyone holding the
  publishable key. It writes task statuses across the whole database.
- **`purge_task`** — **no internal authorisation check at all**, and it
  hard-deletes any trashed task in any workspace.

## My error, recorded

F006d's sweep found the `anon=X` grant back in M1. I read it, judged it
"likely harmless in practice because most functions check auth.uid()
internally", wrote that "likely is doing real work in that sentence",
and deferred it as repo-wide and out of scope.

The judgement was wrong in the way that matters: I reasoned about the
population instead of checking the exceptions. Two functions in that
population have no check at all, and one of them is destructive. A
deferral is only sound if you know what you are deferring, and I did
not — I knew the shape and guessed the contents.

It is also worth naming that round 1 of this milestone's review asserted
the sweep was "granted to postgres, service_role only". That was wrong
too, and it agreed with my own earlier conclusion, which is exactly when
a wrong belief is hardest to dislodge.

## Scope

1. **Fix the default itself.** `alter default privileges … revoke
   execute on functions from anon, authenticated` so a function created
   next year is not exposed by omission. Then audit what the change
   breaks: some functions are *meant* to be callable by
   `authenticated`, and they need their grants restored explicitly.
   Enumerate them in the handoff.
2. **`purge_task`** gets real authorisation matching its Server Action,
   the same way F006n handled the five task RPCs.
3. **`sweep_overdue_blocking_deliverables`** should not be callable by a
   client at all — it is a cron job. Revoke it down to the role pg_cron
   runs as.
4. **Sweep the whole function catalogue against the real `proacl`**, not
   against what the migrations say they revoked. Query
   `pg_proc.proacl` and `pg_proc.prosecdef` directly and list every
   function that is both SECURITY DEFINER and reachable by `anon` or
   `authenticated`, with the authorisation it performs internally. That
   query is the deliverable; the fixes follow from it.
5. Add a test that fails if a new function becomes reachable by `anon`
   without an explicit, deliberate grant.

## Definition of done

- **Primary success test:** `purge_task` and the sweep both reject a
  direct call from an ordinary authenticated session, and from `anon`.
- **Failure test:** every function that legitimately needs
  `authenticated` still works — proven by running the existing suites
  for those features, not by inspection.
- **Manual verification:** the `proacl` audit table is in the handoff.
- **Side-effect verification:** the app works end to end after the
  default-privilege change; this is the kind of fix that breaks things
  quietly, so check the portal and the team app both.
