# Handoff: F023 — Sever the service-role path from lib/ai

## Status
COMPLETE

## Assertions covered
AS-001: PASS — `npx vitest run lib/ai/__tests__/no-service-role.test.ts` walks the transitive
import graph of every file under `lib/ai/**` and `app/api/ai/**` and finds no reachable reference
to `SUPABASE_SECRET_KEY`, `createAdminClient`, or `service_role`. Confirmed the guard can also
FAIL: temporarily re-added `import { resolvePeople } from "@/lib/queries/people";` to
`lib/ai/docs-agent.ts`, re-ran the test, and it failed with the full chain
`lib/ai/docs-agent.ts → lib/queries/people.ts` (and the `app/api/ai/docs/route.ts` entry chained
through it too) reaching `createAdminClient`. Reverted the import immediately after confirming the
failure; final state has no such import.

## Files changed
lib/ai/docs-agent.ts
lib/ai/__tests__/docs-agent.test.ts
lib/ai/__tests__/no-service-role.test.ts (new)

## Commands run
`npx vitest run lib/` (0) — 70/70 passed
`npx tsc --noEmit` (1, but only the 4 documented pre-existing baseline errors: app/layout.tsx
LayoutProps, components/ui/status-badge.tsx style prop, tests/unit/docs-markdown-editor-export-
import.test.tsx x2 — none new, none in files this feature touched)
`npx eslint .` (1, but 0 errors / 26 warnings, same count as documented baseline; no new
warnings, and the new test file itself is fully clean)
`npx eslint lib/ai/__tests__/no-service-role.test.ts` (0) — verified in isolation before the full run

## Decisions made
- Chose fix option (2) — drop the display name from the prompt entirely — per the spec's stated
  preference. Option (1) (RLS-scoped read of the caller's own `profiles` row) was rejected because
  the only existing helper for that (`resolvePeople` in `lib/queries/people.ts`) is intrinsically
  admin-flavoured: it always calls `createAdminClient()` for the batched `profiles` read AND falls
  back to a `SECURITY DEFINER` RPC (`get_users_by_ids`) that reads `auth.users` directly for any id
  without a display name yet. Writing a brand-new RLS-scoped single-row query just for this one
  caller-facing prompt string was out of scope for a "sever the reachability" fix and would have
  reintroduced exactly the kind of parallel identity-resolution path F123's own docs warn against
  building. Dropping the name is the smaller, contained change the spec explicitly prefers.
- `resolveDisplayName` and its import of `resolvePeople` were deleted outright from
  `lib/ai/docs-agent.ts` rather than left dead/unused, so there is no code path left to
  accidentally re-wire. The volatile prompt tail no longer contains a "The user's display name is
  X" line at all; the persona layer already addresses "the user" generically, so no replacement
  wording was needed.
- `userId` stays in `BuildDocsAgentRequestInput` (unused now within the function body, marked
  `void userId;`) because the spec's "Also" section and F006's original doc comment describe it as
  part of the required signature, and a future feature may need it for per-user tool scoping; the
  spec did not ask to remove it from the API surface, only to stop it feeding a service-role read.
- The transitive-import guard test resolves `@/` via `vitest.config.ts`'s own alias definition
  (`fileURLToPath(new URL(".", import.meta.url))` from the config file, i.e. repo root) rather than
  hardcoding a path, and computes the repo root the same way (`new URL("../../../", import.meta.url)`
  from `lib/ai/__tests__/`) so it can't drift from the real config.
- The guard checks *source text* of every reachable file for the three forbidden strings rather
  than trying to determine which specific export a barrel import pulls in. This is a deliberate
  over-approximation chosen for zero false negatives — it cannot be fooled by re-export indirection
  (`export * from`) or by only importing "the other export" from a file that also defines
  `createAdminClient`. It can theoretically false-positive on a file that merely *mentions* one of
  the three strings in a comment (this happened once during this exact task: an explanatory code
  comment in `docs-agent.ts` said the literal words "createAdminClient", tripped the guard, and had
  to be reworded — left as evidence in the git history/handoff rather than hidden, since it's a
  real demonstration the guard is not a rubber stamp).
- Bare/package import specifiers (no `@/` and no leading `.`) are treated as non-repo and not
  walked further — a node_modules package cannot itself reach a repo-local `createAdminClient`
  file via a static import edge, so walking into `node_modules` would only add noise, not coverage.

## Out-of-scope work needed
- F014's currently-planned validation (per its own spec, per this feature's brief) is a flat text
  grep over `lib/ai/tools/` only. It should be pointed at (or replaced by) this feature's new
  `lib/ai/__tests__/no-service-role.test.ts`, or at minimum widened to be transitive and to cover
  `app/api/ai/**` too, so a future F014 change can't silently reopen this exact class of gap. Not
  done here because F014 is a separate feature/spec this worker was not assigned.
- No other `lib/ai/**` or `app/api/ai/**` file currently imports anything admin-flavoured (verified
  by the passing guard), so there is no other cleanup needed right now — but the guard is now the
  standing check that should catch it if one is added later.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Selected fix option (2) over (1) per the spec's own stated preference ("Prefer
(2) if (1) still pulls in anything admin-flavoured") — confirmed (1)'s only existing helper
(`resolvePeople`) is admin-flavoured on both its query paths, so (2) applies.

## Notes for the next worker
- The guard test lives at `lib/ai/__tests__/no-service-role.test.ts`. If you add a new entry point
  under `lib/ai/**` or `app/api/ai/**`, you do not need to update the test — it discovers entry
  files by walking those two directory trees at run time (excluding `__tests__` subfolders).
- If this guard ever fails for you, the assertion message prints the full import chain from the
  entry file down to the offending file, e.g. `lib/ai/docs-agent.ts → lib/queries/people.ts:
  reaches "createAdminClient"` — read the chain, not just the leaf, to find the right place to cut
  the edge (usually: stop importing the offending helper, or split the helper so the admin-using
  part isn't in the same module as anything `lib/ai` needs).
- Be careful writing comments in `lib/ai/**` files that mention `createAdminClient`,
  `SUPABASE_SECRET_KEY`, or `service_role` as literal text — the guard matches source text, not
  just live code, so an explanatory comment containing one of those exact strings will trip a false
  positive (I hit this once while writing this feature's own doc comment and had to reword it).
- No MCP tools were used for this feature — it's a pure code-and-test change with no live schema,
  policy, or remote config to inspect; `mcp-registry.md` was not consulted beyond confirming that.
