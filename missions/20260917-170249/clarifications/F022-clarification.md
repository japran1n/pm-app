# F022 Clarification

_Generated: 2026-09-17T00:00:00Z_  _Mode: accept-and-continue — ★ defaults taken for all questions, no interactive session. The user explicitly instructed the orchestrator to proceed through the full mission autonomously._

## Round A — 10 task questions

**1. Implementation pattern**
- (a) a single "use server" async function in lib/actions/webflow-converter.ts, following the existing lib/actions/ file convention                    ★ recommended  ← chosen
- (b) a class with DI
- (c) a queue-triggered async handler
- (d) split across multiple action files

**2. Data shape**
- (a) plain {html, css, js} strings in, plain serializable object out — no new database row shape involved                    ★ recommended  ← chosen
- (b) a new database table row
- (c) a Zod-validated request/response pair
- (d) FormData

**3. State / storage location**
- (a) none — no state persisted anywhere, this is a stateless compute action                    ★ recommended  ← chosen
- (b) a new Supabase table
- (c) in-memory cache across requests
- (d) client-side only

**4. API contract**
- (a) {ok: boolean, json?, js?, errors, warnings, stats?} — one shape for both success and failure                    ★ recommended  ← chosen
- (b) HTTP-style status codes
- (c) throws on any failure, caller must try/catch
- (d) streaming response

**5. Failure / error handling**
- (a) unparseable/empty input returns {ok:false, message} rather than throwing — the calling component renders the message                    ★ recommended  ← chosen
- (b) throws, caught by an error boundary
- (c) silent retry
- (d) crash and alert

**6. Empty / zero state**
- (a) empty HTML input returns {ok:false, message:"paste some HTML"} without attempting conversion                    ★ recommended  ← chosen
- (b) empty input silently converts to an empty payload
- (c) empty input throws
- (d) not handled, undefined behavior

**7. Validation rules**
- (a) the pure engine's own validator (F020) is the sole source of truth — this layer adds no additional input validation                    ★ recommended  ← chosen
- (b) additional schema validation at the action boundary
- (c) rate limiting
- (d) no validation at this layer

**8. Performance budget**
- (a) not a constraint at this scale (single-section pastes, internal tool, low request volume)                    ★ recommended  ← chosen
- (b) <200ms p95
- (c) <500ms p95
- (d) <2s p95

**9. Auth / access control**
- (a) any signed-in pm-app user (auth.getUser() check only) — no workspace-resource authorization needed since no workspace data is read or written, matching the pattern in lib/actions/chat-channels.ts                    ★ recommended  ← chosen
- (b) workspace-membership check via withAuthz
- (c) role-gated (admin only)
- (d) no auth check at this layer, relies entirely on the page

**10. Dependencies on existing code**
- (a) imports only F021's convert() and pm-app's existing Supabase server client for the auth.getUser() check                    ★ recommended  ← chosen
- (b) reads workspace tables
- (c) reads project tables
- (d) requires new migrations

## Round B — 5 follow-ups

**11. Serialization boundary — Server Actions must return plain serializable data — does convert()'s return shape need adaptation?**
- (a) yes if needed — strip any non-plain values (e.g. Sets used for warning dedup) to arrays before returning; verify with a Server Action round-trip test                    ★ recommended  ← chosen
- (b) no adaptation needed, return as-is
- (c) wrap the whole result in JSON.stringify manually
- (d) convert() itself should be rewritten to avoid this concern

**12. Auth helper reuse — Which existing auth.getUser() call site should this pattern be copied from?**
- (a) lib/actions/chat-channels.ts or lib/actions/docs.ts — whichever has the simpler, most standalone example                    ★ recommended  ← chosen
- (b) lib/actions/authz.ts's withAuthz (workspace-resource-scoped, likely overkill here)
- (c) a new auth helper written just for this feature
- (d) no reference, freehand

**13. Error message content — Should the failure message expose engine internals (e.g. a raw parser error) or a generic message?**
- (a) a clear, specific message when the engine reports one (e.g. "no pasteable elements found"), generic only for truly unexpected exceptions                    ★ recommended  ← chosen
- (b) always generic, never expose internals
- (c) always the raw error, even stack traces
- (d) no message, boolean only

**14. Rate limiting — Does this internal-only action need rate limiting?**
- (a) no — internal tool, small trusted user base, not worth the complexity for v1                    ★ recommended  ← chosen
- (b) yes, per-user rate limit
- (c) yes, per-IP rate limit
- (d) yes, global rate limit

**15. Testing the action itself — How is the Server Action tested, given it wraps a fully-tested pure function?**
- (a) a thin integration test confirming the action calls convert() correctly and shapes the response per F023 — not re-testing engine logic already covered in M2/M3                    ★ recommended  ← chosen
- (b) full re-test of every engine rule at this layer too
- (c) no test, covered by manual QA only
- (d) end-to-end Playwright test only

## Round B — 5 "definition of done" questions

**16. Primary success test**
- (a) a colocated unit test (vitest) on the core function, covering every branch named in this feature's assertion IDs                    ★ recommended  ← chosen
- (b) an integration test only
- (c) an end-to-end test only
- (d) all three

**17. Failure test**
- (a) a unit test on each error/warning branch this feature introduces                    ★ recommended  ← chosen
- (b) an integration test forcing failure
- (c) a chaos test
- (d) error paths tested manually only

**18. Manual verification**
- (a) follow the 2-3 step check named in this feature's own notes (or, for engine features with no UI, run the test file directly and read the output)
- (b) a full demo to the user
- (c) reading log lines only
- (d) none — automated tests suffice                    ★ recommended  ← chosen

**19. Side-effect verification**
- (a) a test or review confirms this feature touches only the files named in its own "Files" line — nothing else in the repo changes behavior                    ★ recommended  ← chosen
- (b) a snapshot test of unrelated data
- (c) no side-effect check
- (d) not applicable

**20. Evidence artifact**
- (a) test output (and, for UI features, a screenshot of the working control) attached to the handoff                    ★ recommended  ← chosen
- (b) a screenshot only
- (c) log lines only
- (d) all of the above
