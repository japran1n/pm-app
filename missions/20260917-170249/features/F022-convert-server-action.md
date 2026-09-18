# F022: convert server action

**Milestone:** M4 — Server wiring
**Estimated worker time:** 25 minutes
**Depends on:** F021

## Assertion IDs covered
- AS-009
- AS-011
- AS-012

## Draft scope
- Add a "use server" action (lib/actions/webflow-converter.ts) that accepts {html, css, js} strings and returns the convert() result as plain serializable data.
- Gate it with a lightweight "is there a signed-in Supabase user" check (auth.getUser(), matching the existing pattern in lib/actions/chat-channels.ts / docs.ts) — no workspace-scoped resource authorization needed since no workspace data is read or written.
- No table read, no table write, no Storage call — confirm with a quick grep that this file imports no query/mutation helpers beyond the auth check.

## Files (approximate)
lib/actions/webflow-converter.ts, lib/actions/webflow-converter.test.ts

## Notes for clarification
This is the only place where the pure engine (M2/M3) touches pm-app's server infrastructure at all — keep it thin.
- MCP at run: none




---

## Clarified implementation (from clarifications/F022-clarification.md)

- Implementation pattern: a single "use server" async function in lib/actions/webflow-converter.ts, following the existing lib/actions/ file convention
- Data shape: plain {html, css, js} strings in, plain serializable object out — no new database row shape involved
- State / storage location: none — no state persisted anywhere, this is a stateless compute action
- API contract: {ok: boolean, json?, js?, errors, warnings, stats?} — one shape for both success and failure
- Failure / error handling: unparseable/empty input returns {ok:false, message} rather than throwing — the calling component renders the message
- Empty / zero state: empty HTML input returns {ok:false, message:"paste some HTML"} without attempting conversion
- Validation rules: the pure engine's own validator (F020) is the sole source of truth — this layer adds no additional input validation
- Performance budget: not a constraint at this scale (single-section pastes, internal tool, low request volume)
- Auth / access control: any signed-in pm-app user (auth.getUser() check only) — no workspace-resource authorization needed since no workspace data is read or written, matching the pattern in lib/actions/chat-channels.ts
- Dependencies on existing code: imports only F021's convert() and pm-app's existing Supabase server client for the auth.getUser() check

### Follow-up decisions
- Serialization boundary: yes if needed — strip any non-plain values (e.g. Sets used for warning dedup) to arrays before returning; verify with a Server Action round-trip test
- Auth helper reuse: lib/actions/chat-channels.ts or lib/actions/docs.ts — whichever has the simpler, most standalone example
- Error message content: a clear, specific message when the engine reports one (e.g. "no pasteable elements found"), generic only for truly unexpected exceptions
- Rate limiting: no — internal tool, small trusted user base, not worth the complexity for v1
- Testing the action itself: a thin integration test confirming the action calls convert() correctly and shapes the response per F023 — not re-testing engine logic already covered in M2/M3

## Definition of done

- **Primary success test:** a colocated unit test (vitest) on the core function, covering every branch named in this feature's assertion IDs
- **Failure test:** a unit test on each error/warning branch this feature introduces
- **Manual verification:** none — automated tests suffice
- **Side-effect verification:** a test or review confirms this feature touches only the files named in its own "Files" line — nothing else in the repo changes behavior
- **Evidence artifact:** test output (and, for UI features, a screenshot of the working control) attached to the handoff

These five answers are what the milestone validators check. A worker is not
done until each definition-of-done answer is satisfied with concrete output
linked from the handoff.
