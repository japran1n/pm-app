# F079: rls audit all tables

**Milestone:** M8 — Security, quality, accessibility, docs, polish
**Estimated worker time:** 30 minutes
**Depends on:** F072

## Assertion IDs covered
- AS-137
- AS-138
- AS-139

## Draft scope
- Audit pass: every workspace-scoped table has RLS enabled; anon-key-only requests return zero rows; cross-workspace joins are blocked

## Files (approximate)
supabase/migrations/ (audit + any missing policy fixes)

## Notes for clarification
This is a review-and-fix feature, not new functionality — read every prior migration's RLS policy and close any gap found.
- MCP at run: Supabase MCP for schema/RLS/Realtime introspection and verification


## Clarified implementation

_Appended by /mission-tasks — accept-and-continue mode, ★ defaults._

- **Pattern:** Server Component for data-fetching, thin Client Component only for the interactive part (smallest possible client boundary).
- **States:** loading (shadcn Skeleton), populated, empty (explicit message + next action), and error (inline retry, real error logged to Sentry) — all four handled explicitly.
- **Responsive:** usable at mobile width via Tailwind's default stacking; no dedicated mobile layout (desktop-first per discovery Q14).
- **Composition:** shadcn/ui primitives from `components/ui/` plus this milestone's already-implemented Server Action(s); lucide-react for icons; sonner for mutation feedback toasts.
- **Access:** relies on the workspace-membership layout guard (F010/F023); no duplicate page-level gate unless the assigned assertion specifically requires role-gating beyond membership.
- **Performance:** primary content server-rendered in initial HTML (AS-155).

## Definition of done

- **Primary success test:** appropriate to feature type — unit test for pure logic (migrations/utilities), integration test for Server Actions touching Supabase, end-to-end (Playwright) only for interaction-heavy assertions (e.g. F090's board reorder).
- **Failure test:** the negative case is asserted explicitly within the same test suite as the happy path (e.g. non-member calling an action, invalid input, cross-workspace access attempt).
- **Manual verification:** none beyond the automated test — per discovery Q26 (critical paths only), the validation contract itself is the sign-off criterion for a solo MVP.
- **Side effects:** where the feature touches workspace-scoped data, the test asserts no other workspace's rows are mutated or returned.
- **Evidence artifact:** test output (pass) referencing the assertion ID by name is the non-negotiable minimum; a screenshot/log line is added where it adds real signal (e.g. Playwright trace for F090).
