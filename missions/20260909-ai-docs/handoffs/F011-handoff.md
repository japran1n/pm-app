# Handoff: F011 — Tool call card

## Status
COMPLETE

## Assertions covered
AS-063: PASS — `shows the tool name, a result glyph, and a one-line summary while running, without exposing detail`, `shows the tool name and the one-line result summary once done, collapsed by default`, `expands to show the result detail when the trigger is activated` in tests/unit/f011-tool-call-card.test.tsx. Note: no "arguments" payload is ever sent to the client (see Decisions made) — the expanded panel shows result detail only.
AS-069: PASS — `is a real, focusable button element, not a div with an onClick handler`, `carries visible focus-state classes`, `is reachable via standard tab order (not removed from it)`, `is marked non-actionable (but stays focusable) when there is no detail to expand` in tests/unit/f011-tool-call-card.test.tsx.
AS-070: PASS — `contains no hex colour literals in its source`, `uses --line-row (not --border) for internal row separators` (static source-regex tests) plus manual review of every className added.

## Files changed
components/ai/tool-call-card.tsx (new)
components/ai/assistant-sidebar.tsx
tests/unit/f011-tool-call-card.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f011-tool-call-card.test.tsx tests/unit/f009-assistant-sidebar.test.tsx tests/unit/f010-assistant-thread.test.tsx lib/ai` (0) — 9 files / 83 tests passed
`npx tsc --noEmit` (1, but only the 4 documented pre-existing errors: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, tests/unit/docs-markdown-editor-export-import.test.tsx x2 — zero new errors)
`npx eslint components/ai/tool-call-card.tsx components/ai/assistant-sidebar.tsx tests/unit/f011-tool-call-card.test.tsx` (0, no output)

Per the mission's standing rule (`state.md`), the full `npm test` was NOT run.

## Decisions made
- **Disclosure primitive**: checked `components/ui` first per the spec's explicit instruction. `components/ui/collapsible.tsx` wraps `@base-ui/react/collapsible` (`Collapsible`/`CollapsibleTrigger`/`CollapsibleContent`) and is already used elsewhere in this codebase's design system — it renders a real `<button type="button">` trigger with proper `aria-expanded`/`aria-disabled` and standard tab order, so used it directly instead of a native `<details>`/`<summary>` (which would have been an equally valid choice per the spec, but reusing the existing primitive keeps this consistent with the rest of the component library rather than introducing a second disclosure pattern).
- **Failure signal**: `ToolCallView` (lib/ai/use-doc-assistant.ts) has no explicit `error`/`ok` boolean — only `status: "running" | "done"`. Read `app/api/ai/docs/route.ts` (the only producer of `tool_end` events) and confirmed every failure path — tool-not-found (line ~422-424) and a thrown tool error (line ~448-453) — sends the exact literal `summary: "tool error"`, while `summarizeToolResult` (the success path) never returns that literal. Used `toolCall.status === "done" && toolCall.summary === "tool error"` as the sole failure signal (`isFailed` in tool-call-card.tsx) rather than inventing a new status value that doesn't exist in the wire protocol.
- **"Arguments" in the expanded view**: the spec says "Expands to show arguments and result detail," but `tool_start` only ever carries `{id, name}` (both use-doc-assistant.ts's event-envelope header comment and route.ts's `send({ t: "tool_start", id: toolUse.id, name: toolUse.name })` call site confirm this — the model's tool input is never sent to the client at all, by design, not by a bug). There is therefore no arguments payload in the data model for this card to render. The expanded panel shows `detail` only. This is a data-availability constraint upstream of this feature's scope, not a decision to omit something that was available — flagged below as out-of-scope follow-up work rather than silently working around it.
- **Colour register for the failure glyph/detail text**: used `text-status-waiting` (the same amber "needs the user's attention" register F009 already established for the sidebar's `error` event, per that feature's own handoff) rather than `text-status-blocked` (red) — keeps one consistent "attention" vocabulary across the whole panel instead of introducing a second, more alarming failure colour for what is often a benign, retryable tool miss (e.g. a doc search returning nothing).
- **Quiet-by-default styling**: `ToolCallList` renders `null` when empty (an empty region reads calmer than an empty bordered box), and the list container uses `border-line-row`/`divide-line-row` (never `border-border`) per the two-family rule — the cards read as a subordinate, internal list, not a second panel competing with the panel's own `border-border` edge or the assistant's text above it. Zero shadow anywhere in the file (not an overlay). No `bg-primary` usage. Row trigger only gets a `hover:bg-muted` fill when it actually has something to expand (`hasDetail`) — a non-expandable running row stays fully static, matching the "quiet, not interactive-looking when it isn't" intent.
- **Font weight**: no `font-semibold`/`font-medium` overrides used beyond the codebase's default text classes (`text-mini`/`text-micro`, which already resolve through the theme's weight variables) — nothing in this card is heading-weight, consistent with "must never compete with the assistant's text."
- Wired `ToolCallList` into `components/ai/assistant-sidebar.tsx`, replacing the `assistant-sidebar-tool-cards-placeholder` reserved div F009 left, and destructured `toolCalls` from the existing single `useDocAssistant(...)` call already in that file (did not call the hook a second time, per F009's handoff note that a second instance would double-request).

## Out-of-scope work needed
- **Wire-protocol gap**: `tool_start` never sends the model's tool input to the client, so no "arguments" data exists anywhere in `useDocAssistant`'s state for this or any future feature to render. If the product wants the expanded card to show what the tool was called *with* (not just its result), a follow-up needs to (a) add a sanitised, length-bounded argument summary to the `tool_start` (or `tool_end`) event in `app/api/ai/docs/route.ts` — following the exact same "server computes a safe one-line/bounded string, never forwards raw model output" pattern F026/F032 already established for `detail` — and (b) extend `ToolCallView`/the NDJSON parser in `lib/ai/use-doc-assistant.ts` to carry it, and (c) render it in `components/ai/tool-call-card.tsx`'s expanded panel alongside `detail`. This is a protocol change spanning three files outside this feature's `Touches` list, not something this worker should do silently.
- Proposal cards (F015/F016) — untouched, per spec's stated out-of-scope.
- Composer internals (F012) — untouched.
- Real empty state (F013) — untouched.
- The `--text-quaternary` token gap flagged by F009's handoff remains open and unaffected by this feature (nothing here needed a decorative-only label; the running-state summary text uses `text-muted-foreground` like the rest of the panel, not a quaternary-only string).

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Treated `summary === "tool error"` (the exact literal string `app/api/ai/docs/route.ts` sends on every failure path) as the sole failure signal for a "done" tool call, since `ToolCallView` has no dedicated error field — verified both failure call sites in route.ts send this exact literal and that the success path's `summarizeToolResult` helper cannot produce it.
AUTONOMOUS_DECISION: Rendered only `detail` (not "arguments") in the expanded panel, since no arguments payload is ever sent over the wire — see Out-of-scope work needed for the suggested follow-up spec if the product wants that changed.
AUTONOMOUS_DECISION: Used the existing `components/ui/collapsible.tsx` (`@base-ui/react` wrapper) rather than a native `<details>`/`<summary>` — both satisfy the spec's accessibility requirement, but reusing the codebase's one existing disclosure primitive keeps a single consistent pattern rather than introducing two.

## Notes for the next worker
- `ToolCallList` is exported alongside `ToolCallCard` from `components/ai/tool-call-card.tsx` — `ToolCallList` is what's mounted in `assistant-sidebar.tsx`; `ToolCallCard` is exported separately in case a future feature (e.g. a per-message inline tool-call rendering, if the product ever wants tool calls interleaved with specific assistant turns rather than pooled at the bottom of the thread region) needs to render a single card without the list wrapper.
- Tool calls currently render in one pooled region below `<AssistantThread />` (same DOM slot F009/F010 reserved), not interleaved per-message — `ToolCallView[]` from `useDocAssistant` has no message-id association to interleave by, so this was the only structurally honest placement available without inventing an association the hook doesn't provide.
- No MCP tools were used for this feature — pure client-side UI rendering with no external service or live schema dependency.
