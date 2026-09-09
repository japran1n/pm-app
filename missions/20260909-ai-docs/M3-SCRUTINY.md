# M3 Scrutiny — Gated writes (F014–F017)

Verdict: **FAIL**. Two BLOCKERs and one HIGH must be fixed before M4.

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-002 | PASS (create path unverified) | All access via `createClient()` from `@/lib/supabase/server` or `createDoc`/`updateDoc`; no test pins this for `applyDocCreateProposal` (createDoc fully mocked). |
| AS-003 | PASS (weak) | Transitive AST import-graph guard with a falsifiability fixture; blind to computed member access (`x["update"](...)`). |
| AS-009 | PASS (fragile) | Single `updateDoc(docId, title, proposedMarkdown)`; guard is read-then-write TOCTOU, `updateDoc` has no CAS predicate. |
| AS-010 | PASS by inspection / INCONCLUSIVE by test | Reject is a synchronous `setProposals`; no test asserts zero server calls end-to-end or unchanged `updated_at`. |
| AS-025 | PASS | Envelope carries `docId`, `proposedMarkdown`, `diff`; no mutation on any path. |
| AS-026 | PASS | Draft envelope only; single `.select()` on `doc_folders`; explicit `data.workspace_id !== workspaceId` check at create-doc.ts:77. |
| AS-028 | FAIL (blocker) | `propose_doc_edit`'s cross-workspace test mocks out `get_current_doc`, the only component that enforces isolation — it passes whether or not `workspaceId` is honoured. |
| AS-043 | PASS | route.ts emits `proposal`, breaks the tool loop, then `usage` + `done`; gated on `PROPOSAL_TOOL_NAMES`. |
| AS-064 | PASS | Card renders diff + Accept/Reject buttons; empty diff renders an empty box (cosmetic). |
| AS-065 | FAIL (blocker) | Thrown server action leaves the card silently pending with no error; create path is non-idempotent and leaks orphan docs on retry. |
| AS-066 | PASS | `handleReject` is a pure synchronous callback; test proves zero calls to write path and editor bridge. |
| AS-069 | PASS (weak) | Real `<button>`s with the shared `focus-visible` ring; test asserts a className regex, not behaviour. |
| AS-070 | PASS | No hex literals in `proposal-card.tsx`, `diff-view.tsx`, `assistant-sidebar.tsx`. |
| AS-100 | PASS | 0 errors, 26 warnings, none in M3 paths. |
| AS-101 | FAIL (pre-existing, not M3) | 4 tsc errors, all in files untouched by M3. |
| AS-102 | INCONCLUSIVE | M3 files: 113/113 pass. Full suite: 37 failures in unrelated legacy test files. |

## Findings

### BLOCKER-1 — silent failure on Accept (AS-065)
`components/ai/proposal-card.tsx:315-361` and `:155-182`. Both accept handlers use
`try { ... } finally { setIsApplying(false) }` with **no `catch`**. A server action that
throws (network drop, 500, stale action id after deploy) leaves `applyError === null`,
resets `isApplying`, and re-arms Accept. A failed write is indistinguishable from a
no-op click. No test drives either action to `{ok:false}` or to a rejection, so the
suite cannot see this.

### BLOCKER-2 — non-idempotent create + orphan doc (AS-065, AS-009)
`lib/actions/ai-proposals.ts:172-188`. `createDoc` then `updateDoc`; if `updateDoc`
fails, an empty untitled doc is already persisted and never cleaned up, the card shows
an error and stays pending with Accept enabled — clicking again creates a second doc.
No idempotency key or proposal id reaches the action. This is deterministically
reachable, not just transient: an empty `title` is unvalidated before `createDoc` but
rejected by `updateDoc` (`lib/actions/docs.ts:235-238`), so every Accept litters a row.

### BLOCKER-3 — AS-028 cross-workspace test is vacuous
`lib/ai/tools/__tests__/propose-doc-edit.test.ts:127-149` mocks
`get_current_doc.run` to return a hand-written `empty` envelope. All isolation logic
lives inside the mocked module. The test is byte-identical in setup to the `not_found`
test at `:106` and would pass if `propose_doc_edit` ignored `workspaceId` entirely.

### HIGH-1 — truncated document written over the real one
`lib/ai/tools/propose-doc-edit.ts:145-157`. `message.stop_reason` is never inspected.
On `max_tokens` (32k cap, shared with adaptive thinking, against a doc up to 40k chars)
`responseText` is a partial document; it is non-empty and differs from the base, so a
proposal is returned whose `proposedMarkdown` is cut off mid-sentence. The staleness
guard compares the *base*, so it passes, and Accept writes the truncated text. The diff
renders the lost tail as ordinary removed lines. Unrecoverable content loss on the
happy path.

### HIGH-2 — >40k-char docs are permanently broken and blame the user
`propose-doc-edit.ts:113,122` destructures `{title, markdown}` from `get_current_doc`
and never reads its `truncated` flag (`lib/ai/tools/get-current-doc.ts:113,120`). The
stored `currentMarkdown` is a prefix, so `ai-proposals.ts:101` can never match live
content: every proposal on a large doc fails with "The document changed since this
proposal was made", which is false.

### HIGH-3 — prompt-injection boundary is unescaped
`propose-doc-edit.ts:137` interpolates `currentMarkdown` raw between
`<current_document_markdown>` tags, then places `Instruction: ...` immediately after.
Doc content — which may be authored by a client-portal user outside the team —
containing a literal `</current_document_markdown>` line escapes the block into the
trusted instruction slot. The system prompt itself is a static constant with no
interpolation (correct); the gap is entirely in the user turn. No test plants a
breakout string. Bears directly on AS-006.

### MEDIUM
- `ai-proposals.ts:101-105` — staleness guard is TOCTOU; `updateDoc`'s bare
  `.eq("id", docId)` cannot detect an interleaved write. Normalization also silently
  clobbers whitespace-only concurrent edits.
- `ai-proposals.ts:177` — `workspaceId` arrives from the client payload and reaches
  `createDoc` with zero application-layer membership check; blocked only by RLS
  `with check`, surfacing as a generic "Something went wrong".
- `ai-proposals.ts:175-177` — accept-time `folderId` is not re-validated against the
  workspace, so the tool's draft-time cross-workspace check does not survive the
  client round trip; a doc in workspace A can carry a `folder_id` from workspace B.
- `no-writes.test.ts:88-95` — matches only `PropertyAccessExpression` callees;
  `supabase.from("docs")["update"](...)` and destructured builders evade it. Also
  false-positives on `Map`/`Set.delete`, which pressures future loosening.
- `propose-doc-edit.ts:94-98` — `unwrapMarkdownFence` runs unconditionally; a document
  that legitimately *is* one fenced code block gets its fences stripped.
- `propose-doc-edit.ts:145` — no timeout/`AbortSignal` on the internal model call
  (bears on AS-027).
- `proposal-card.tsx:316` — the double-click guard reads `isApplying` from a stale
  closure; correctness rests on React's discrete-event flush, not on a `useRef` latch.
- `proposal-card.test.tsx:157-198` — accepted/rejected states are tested by
  pre-setting `status`; the click→collapse wiring in `assistant-sidebar.tsx:597`
  is untested. Replacing `onAccept={acceptProposal}` with a no-op keeps the suite green.

### LOW
- `create-doc.ts:19-27,62-66` header comment claims an `.eq("workspace_id", ...)`
  filter that does not exist (it is a post-fetch JS compare) — a reader who "restores"
  it breaks the mocked query chain in the tests.
- No test for `folder_fetch_failed`; no size bound on `title`/`markdown`.
- `ai-proposals.test.ts:196-214` are argument mirrors; `:79-92` overclaims AS-002.
- Accept/reject state is in-memory only (`use-doc-assistant.ts:139`) — no audit trail.
- `diff-view.tsx:78` renders unbounded rows; no truncation for whole-doc rewrites.
- XSS clean: no `dangerouslySetInnerHTML` under `components/ai/`.

## Recommended follow-up features

**F0xx — Harden proposal acceptance against silent failure and duplicates.** Add a
`catch` to both accept handlers in `components/ai/proposal-card.tsx` so a thrown server
action surfaces a `role="alert"` message rather than resetting to a re-armed pending
card; replace the `isApplying` state guard with a synchronous `useRef` latch. Make
`applyDocCreateProposal` idempotent: pass the proposal id, validate `title` before
`createDoc`, and either create-and-update in one action or delete the orphan row when
`updateDoc` fails. Add tests that drive Accept through `{ok:false}`, through a thrown
action, and through a double click, asserting exactly one write.

**F0xx — Stop `propose_doc_edit` proposing partial documents.** Inspect
`message.stop_reason` and return a structured `err("proposal_truncated", ...)` instead
of a proposal when generation hits `max_tokens`. Read `get_current_doc`'s `truncated`
flag and refuse to propose against a truncated base with an honest message, rather than
producing a proposal that the staleness guard rejects with a false explanation. Add an
`AbortSignal`/timeout to the model call for AS-027. Tests for each branch.

**F0xx — Close the injection boundary and re-validate scope at accept time.** Escape or
reject occurrences of the closing delimiter in `currentMarkdown` before interpolation in
`propose-doc-edit.ts:137`, with a test that plants a breakout string and asserts the
model call's text cannot be read as an instruction. Separately, re-derive `workspaceId`
server-side in `applyDocCreateProposal` (or verify membership explicitly) and
re-validate that `folderId` belongs to that workspace before `createDoc`, with tests for
both cross-workspace vectors.

**F0xx — Make the write-safety and isolation guards actually falsifiable.** Extend the
AST walk in `no-writes.test.ts` to element-access callees and reduce its false-positive
surface. Rewrite `propose-doc-edit.test.ts:127` to exercise the real `get_current_doc`
against a mocked Supabase row from another workspace, so AS-028's isolation clause is
genuinely covered. Add a test asserting Reject issues zero server calls, and an
assistant-sidebar-level test that Accept collapses the card through the real wiring.

## Gates

- `npm run lint` — 0 errors, 26 warnings, none in `lib/ai/**`, `components/ai/**`, or
  `lib/actions/ai-proposals.ts`.
- `npx tsc --noEmit` — 4 errors, all pre-existing and outside M3:
  `app/layout.tsx(29,50)`, `components/ui/status-badge.tsx(45,62)`,
  `tests/unit/docs-markdown-editor-export-import.test.tsx(75,18)` and `(75,48)`.
- `npx vitest run lib/ai/tools/__tests__/no-writes.test.ts` — 1 file, 4 tests, passed.
- `npx vitest run lib/ai components/ai lib/actions/__tests__/ai-proposals.test.ts` —
  12 files, 113 tests, all passed.
- `npx vitest run` (full) — 62 files failed / 568 passed; 37 tests failed / 4231 passed.
  Observed failures are in unrelated legacy suites (`tests/unit/f246-task-detail-sheet-copy-link.test.tsx`,
  `tests/unit/board-taskid-deeplink.test.tsx`, Next.js error `E251`); not attributed to
  M3, but AS-102 cannot be marked PASS while the suite is red.
- `npx vitest run` (second full run, same commit) — 40 files failed / 590 passed;
  43 tests failed / 4358 passed. The counts differ from the first run (62 files / 37
  tests) on identical code, so the full-suite red is **non-deterministic** — load- or
  timing-sensitive legacy suites, not a deterministic M3 regression. AS-102 stays
  INCONCLUSIVE, and the flakiness itself is a separate pre-existing problem.
