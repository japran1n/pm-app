# F003: supabase project link

**Milestone:** M1 — Foundation
**Estimated worker time:** 30 minutes
**Depends on:** F001

## Assertion IDs covered
- (none — foundation/skeleton feature)

## Draft scope
- Add `supabase/migrations/` and `supabase/seed.sql` (empty placeholder)
- Write lib/supabase/client.ts and server.ts stubs (real implementation is F006)
- Write .env.example with all required keys, no values

## Files (approximate)
supabase/, .env.example

## Notes for clarification
This feature only prepares the directory structure and env template; it does not require live Supabase credentials — those arrive in /mission-connect before /mission-run.
- MCP at run: none


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Pattern:** single script/config change per feature, no unnecessary abstraction.
- **Failure handling:** if a setup command fails, Status = BLOCKED with the exact command and error text in Blockers.
- **Success proof:** the exact command from tech-decisions.md's relevant "How to run ..." section exits 0.
- **Scope:** builds only on this feature's own new files/config plus the prior M1 feature's output — no forward dependencies on later milestones.

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
