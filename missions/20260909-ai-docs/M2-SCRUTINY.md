# M2 scrutiny verdict — FAIL (2026-09-09)

Six blockers, seven majors. Three blockers were proven by **mutation**, not inspection — the
reviewer changed the code, saw the tests still pass, and reported it. That is the standard this
mission needed and did not have earlier.

## Blockers
- **B1 — AS-063 is broken in production; its test uses a fabricated fixture.**
  `route.ts:438` (tool success path) sends `tool_end` with **no `detail`**, and
  `summarizeToolResult` returns the bare literal `"ok"`. So `tool-call-card.tsx:88` computes
  `hasDetail=false` and renders an **inert, unclickable row** reading `search_docs  ok`.
  Expansion works only when the tool *threw*, revealing the constant "Tool execution failed."
  `f011-tool-call-card.test.tsx:33-43` invents `summary`/`detail` strings the route cannot emit.
- **B2 — AS-062 and AS-067 tests are tautological.** Proven: buffering every delta and flushing
  once at `done` (deleting progressive rendering) still passes AS-062. Deleting
  `abortControllerRef.current?.abort()` from `stop()` still passes 10/10.
- **B3 — AS-071 breaks the moment the user does what the UI invites.** Chips are not key-aware;
  clicking one optimistically appends a user turn, which unmounts the empty state *and its
  explanation*, then a second, differently-worded message appears. Two explanations, a phantom
  turn, no way back (`reset` exists on the hook but the sidebar never destructures it).
- **B4 — F009 regressed the existing breadcrumb.** `useSetBreadcrumb` is a single-slot replace.
  The editor's write clobbers `ProjectBreadcrumb` on project-doc routes, and its unmount cleanup
  blanks the project crumb entirely. Pre-existing app behaviour, broken by this mission.
- **B5 — broken scroll containment.** `assistant-sidebar.tsx:331` has a comment claiming an
  independent scroll region and **no `overflow` class**. `ToolCallList` is an unshrinkable
  sibling; with several tool cards it overflows the `aside`, painting over the composer and off
  the viewport. Renders perfectly in jsdom.
- **B6 — the <1180px overlay cannot be closed.** The only toggle sits under the overlay. No close
  button, Escape, backdrop, outside-click, or focus trap. State persists, so reload restores it.

## Majors
- `stop()`/`reset()` don't stop event *application* — after `stop()` a message grew; after
  `reset()` a cleared conversation repopulated.
- No unmount cleanup at all; the hook has no `useEffect`. Model keeps generating and billing.
- **F028's conversation history is dead on arrival** — the hook never sends `messages`. The
  assistant is amnesiac and nothing detected it.
- Assistant markdown uses bare `prose` with no `prose-invert` and no `--tw-prose-*` overrides →
  near-black headings on the dark panel. (Inferred from CSS; needs a browser check.)
- No IME composition guard — CJK users submit partial candidates on Enter.
- `tool_start` after `tool_end` regresses a finished call to a permanent spinner.
- Non-2xx discards every real server message; session expiry looks like a bug.

## Verified clean (do not re-litigate)
Auto-scroll is genuinely correct and `f010:124-136` is the strongest test in the milestone.
`aria-live="polite"` + `role="log"`. Full AS-069 element sweep passes. `--text-quaternary`
genuinely unused. Font weights fine (510/590 are redefined in globals.css — two earlier reviewers
were wrong about this). No colour literals. Shadow rule respected. `hasApiKey` server-side wiring
correct. Markdown XSS safe (transitively, untested). `isStreaming` never sticks. Height chain
sound except B5.

**TipTap-per-message:** real but not urgent. 25 editors for 50 messages, properly destroyed. The
waste is per-token — `getMarkdown()` + `setContent` round-trips ~3.2 MB for a 4 KB answer, and the
guard is near-dead code because markdown serialisation is not identity-preserving. Delete the
guard now, replace the editor later.

## Handoff claims the code does not support
1. F011 graded `AS-063: PASS` while its own Decisions section diagnoses the gap. The commit
   message (`ad186ae2`) is the honest one.
2. F009 graded `AS-061: PASS` and claimed a regression sweep covering "every file whose behaviour
   it depends on" — it never touched `ProjectBreadcrumb` (B4).
3. F012's composer comment claims usage events are discarded and the prop unwired. Both false.
