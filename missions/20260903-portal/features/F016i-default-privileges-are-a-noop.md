# F016i: The forward-looking half of F016g does nothing

**Milestone:** M3 remediation — **blocker for starting M4**
**Estimated worker time:** 2 h
**Opened by:** the M3 third gate

## The defect

`alter default privileges … revoke execute on functions from public` is
a **no-op**: Postgres merges the stored default ACL with the built-in
`EXECUTE TO PUBLIC` grant, so the revoke has nothing to remove.

The reviewer proved it rather than inferring it. F016h's own new
function, created after F016g landed:

```
clear_client_deliverable_swept_at()
  proacl = {=X/postgres, postgres=X/postgres, service_role=X/postgres}
  has_function_privilege('anon', …, 'EXECUTE') = true
```

and a throwaway function created in a rolled-back transaction
reproduces it exactly.

Today's exposure is nil — that function returns `trigger` and cannot be
called over PostgREST. But **every function M4 adds will be
anon-callable** unless its own migration remembers to revoke, and
F016g's test only checks two named pre-existing functions, so nothing
would surface it. M4 adds several functions, including ones that read
billable hours.

That is why this blocks starting M4 rather than M3's own assertions.

## Scope

1. Make new functions safe by construction rather than by memory. An
   event trigger on `ddl_command_end` for `CREATE FUNCTION` that revokes
   EXECUTE from `public` is the version that cannot be forgotten. If
   Supabase's environment does not permit an event trigger, say so with
   the error, and fall back to the strongest thing that does work.
2. **A test that fails when any function is `anon`-executable without
   an explicit allow-list entry**, derived from the catalog rather than
   from a hard-coded pair of names. That test is the real deliverable:
   it turns "someone must remember" into "CI says no".
3. Re-check the functions created since F016g — at minimum F016h's and
   F016b's — and revoke where needed.

## Definition of done

- **Primary success test:** a function created in a scratch migration
  is not `anon`-executable without an explicit grant, proven by
  `has_function_privilege`.
- **Failure test:** every function that legitimately needs
  `authenticated` or `anon` still has it — run the suites for those
  features, do not reason about it.
- **Manual verification:** the catalog-derived test fails if you
  deliberately grant `anon` EXECUTE on a scratch function.
- **Side-effect verification:** the portal and the team app both work;
  this is the same class of change that broke two things quietly in
  F016g.
