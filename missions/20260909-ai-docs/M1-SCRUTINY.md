# M1 scrutiny verdict — FAIL (2026-09-09)

Adversarial review of F001–F007. 3 blockers, 6 majors. **M2 does not start until B1–B3 and
M1a, M1c, M1d, M1e are fixed.** Remediation features F023–F028 below.

## Blockers

### B1 — AS-001 violated: `lib/ai/**` transitively imports a service-role client
`lib/ai/docs-agent.ts:23` → `lib/queries/people.ts:50,75` → `lib/supabase/admin.ts:14` →
`process.env.SUPABASE_SECRET_KEY`. Not a rare branch: `resolveDisplayName` runs on **every
request** (`docs-agent.ts:155`), and `resolvePeople` falls back to the Auth Admin API, so a
docs chat turn can reach `auth.users`.

Contained today (called with the caller's own id), but the mission's central architectural
rule is broken in the very file that assembles the model's prompt. **And F014's planned grep
test cannot catch it** — it greps `lib/ai/tools/` for literal `.insert(` etc., which passes
cleanly while the violation sits one import hop away. Exactly the false confidence the gate
existed to find.

### B2 — Every cross-workspace isolation test is a tautology
The mocks say so themselves (`search-docs.test.ts:110`, `list-doc-templates.test.ts:73`).
`get-current-doc.test.ts:74` (AS-008) is **byte-identical** to the not-found test at line 63.
`search-docs.test.ts:125` asserts a string the test wrote lacks a word the test never wrote.

**Not one of the 18 tool tests would fail if RLS were dropped entirely or a service-role
client were used.** 38 tests pass in 398 ms — no test in M1 ever touched a database.

This repo already rejects exactly this: `tests/integration/palette-search-private-project-leak.test.ts:1-19`
— *"repeated real privilege-escalation bugs in exactly this shape… proves that end-to-end,
not by code review alone."* F003–F005 assert the same property and supply only the code
review that file rejects.

### B3 — The abort path throws `TypeError` on every aborted request
`route.ts:338-340`: `cancel()` calls a module-scope zero-arg noop (line 352) that cannot
reach the per-request `abortController` closure and never sets `closed`. User clicks stop →
`finish()` at line 214 runs with `closed` still false → `controller.close()` on a closed
controller → unhandled rejection. The precise path AS-044 exists to cover.

The test at `f007-docs-agent-route.test.ts:265-281` **never aborts** — it asserts
`options?.signal instanceof AbortSignal`, which a fresh never-aborted signal passes identically.

## Majors

- **M1a (AS-105)** `route.ts:284` sends raw `error.message` to the browser while line 283
  deliberately keeps it out of the log — self-indicting asymmetry. `types.ts:33` forbids it.
  Reachable via Zod v4 parse errors (which embed offending input) and transport errors carrying URLs.
- **M1c (AS-023/AS-024)** Not met even with perfect RLS. `docs_select_active_members` scopes to
  *every* workspace the user belongs to; the contract says **current** workspace. Neither tool
  takes a workspace id. Repo convention is the opposite (`lib/queries/docs.ts:163`).
- **M1d** PostgREST filter injection in `search-docs.ts:106-111`: escapes `%`/`_` only, then
  interpolates into a filter *string* where comma/parens/dot are grammar. Cannot cross a
  workspace boundary (RLS ANDs over it) but breaks ordinary punctuation and is LLM-generated text.
- **M1e (AS-047, and AS-061 pre-emptively)** `route.ts:176-178` sends only the latest message —
  `threadId` is parsed and dropped. **There is no conversation history at all.** Every request is
  turn 1, so "the second turn of a conversation" cannot exist and caching is unverifiable.
- **M1f (AS-043)** Green purely on a test double — `propose_doc_edit` does not exist yet.
  Proposal detection also duck-types on tool *output* rather than a tool-name allowlist.
- Search has no `.order()` — non-deterministic which 10 of N rows return.

## What genuinely holds (verified, not assumed)
- **AS-003 write safety — the mission's central claim — holds.** Full transitive graph traced
  from all three tool `run` functions; zero mutation calls reachable.
- **AS-021 existence leak — clean.** Identical message, identical `reason`, no differing log line.
- **AS-006 mechanism is sound** and well written; document text reaches the model only as
  `tool_result` in user turns, never interpolated into the system prompt. Only its *test* is worthless.
- AS-007, AS-045, AS-046, AS-048 genuinely tested and correct. Migration mechanically sound.
