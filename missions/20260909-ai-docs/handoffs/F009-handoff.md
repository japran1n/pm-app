# Handoff: F009 — Sidebar shell

## Status
COMPLETE

## Assertions covered
AS-060: PASS — `is closed by default and opens when the header toggle is clicked`, `persists the open state to localStorage and restores it on a fresh mount (reload)`, `closing again persists the closed state`, `never throws even if localStorage access itself throws (private browsing)` in tests/unit/f009-assistant-sidebar.test.tsx.
AS-061: PASS — `shows the announced doc title in the context bar`, `updates the title on navigation to a different doc without remounting the panel (thread preserved)`, `falls back to a decorative 'no doc open' hint when no doc is open`.
AS-070: PASS — `contains no hex colour literals in its source` (static source-regex test) plus manual review of every className in the new file.
AS-071: PASS — `still renders the panel and shows one explanatory, non-destructive message with the composer disabled`, `renders the composer region (not the no-API-key notice) when an API key IS configured`.

## Files changed
components/ai/assistant-sidebar.tsx (new)
components/nav/app-header.tsx
app/(workspace)/w/[workspaceSlug]/layout.tsx
components/docs/markdown-editor.tsx
tests/unit/f009-assistant-sidebar.test.tsx (new)

## Commands run
`npx vitest run tests/unit/f009-assistant-sidebar.test.tsx` (0) — 10/10 passed
`npx vitest run lib/ai` (0) — 6 files / 52 tests passed, unchanged
`npx vitest run tests/unit/breadcrumb-context-no-loop.test.tsx tests/unit/docs-markdown-editor-export-import.test.tsx tests/unit/f119-sidebar-short-viewport.test.tsx tests/unit/docs-sidebar-new-folder-doc-buttons.test.tsx` (0) — 13/13 passed (regression check on every file this feature touched or whose behaviour it depends on)
`npx tsc --noEmit` (1, but only the 4 documented pre-existing errors: app/layout.tsx LayoutProps, components/ui/status-badge.tsx overload, tests/unit/docs-markdown-editor-export-import.test.tsx x2 — zero new errors)
`npx eslint components/ai/assistant-sidebar.tsx components/nav/app-header.tsx components/docs/markdown-editor.tsx "app/(workspace)/w/[workspaceSlug]/layout.tsx" tests/unit/f009-assistant-sidebar.test.tsx` (0, no output)

## Decisions made
- Mounted the panel as a sibling of the existing raised content panel inside `<div className="flex h-svh">` in layout.tsx, per the spec's RESOLVED mount-point note — added `AssistantSidebarProvider` around the whole row (nested inside `BreadcrumbProvider`, outside the `<div className="flex h-svh">`) so its boolean context reaches both the header toggle (deep inside `WorkspaceMain`) and the panel (a direct sibling) without prop-drilling.
- All exports (provider, `useAssistantSidebarContext`, `AssistantSidebarToggle`, `AssistantSidebar`) live in the single `components/ai/assistant-sidebar.tsx` file the spec names, rather than splitting into a separate context file — kept to the spec's stated file list.
- `--text-quaternary` is referenced by CLAUDE.md/the spec's design rules but has **no Tailwind utility wired up anywhere in this codebase** (grepped `app/globals.css`'s `@theme` block and the whole repo — the CSS custom property itself doesn't even exist, only the doc comment does). Used `text-muted-foreground` for the one decorative "No doc open" hint instead of inventing a `text-quaternary` class that would resolve to nothing. Flagged under Out-of-scope work needed below.
- Token mapping follows the spec's RESOLVED table verbatim: `error` events render on `bg-status-waiting-bg`/`text-status-waiting` (proposed/attention register — no proposal UI exists yet in F009's scope, so this is the closest existing semantic use for a "needs the user's attention" message); the AS-071 no-API-key notice uses the plain `bg-muted`/`text-muted-foreground` pair (the RESOLVED table's "rejected / settled-neutral" mapping) since a configuration-not-yet-set state is calmer than either the waiting/attention or done/success registers.
- `currentDocId` is derived from `usePathname()` via a trailing `/docs/<id>` regex rather than threaded through a new context value — both doc routes in this codebase (`/w/[slug]/docs/[docId]` and `/w/[slug]/projects/[projectId]/docs/[docId]`) share that exact trailing shape, so one regex covers both workspace- and project-scoped docs without adding a second provider.
- Added `useSetBreadcrumb([{ label: title || "Untitled" }])` to `components/docs/markdown-editor.tsx` (a small, targeted addition, not a rewrite) so the assistant sidebar's context bar has a real title to read via `useBreadcrumbExtra()` — the spec explicitly told me to check whether `BreadcrumbProvider` already tracked the current doc before adding a new provider; it did NOT (no doc page called `useSetBreadcrumb` before this change, confirmed via grep), so this is the minimum wiring needed to make AS-061 true using the existing "leaf announces itself upward" pattern (`components/project/project-breadcrumb.tsx`'s exact convention) rather than inventing a second mechanism. This also means doc titles now show in the page breadcrumb itself as a side effect — a strict improvement, not a regression, and zero new surface area (same context, same hook).
- Below ~1180px the panel switches to `fixed` positioning (`max-[1180px]:fixed max-[1180px]:inset-y-2 max-[1180px]:right-2 max-[1180px]:z-40 max-[1180px]:m-0 max-[1180px]:shadow-lg`) rather than squeezing the content panel — per the spec's explicit instruction, this is the one place in the component that takes a shadow, under the shadow rule's documented overlay exemption. This is a pure Tailwind responsive-variant approach (no JS media-query listener) — the panel is a real flex child at wide viewports and a `fixed`-positioned overlay below the breakpoint, achieved with the same className the whole time.
- `useDocAssistant` is called once inside `AssistantSidebar` with the real `workspaceId`/`currentDocId` (not stubbed) so F010–F013 inherit a live hook instance already wired to the panel's own DOM structure — but only `messages`, `isStreaming`, and `error` are read here; `toolCalls`/`proposals`/`send`/`stop`/`reset` are untouched, per the "message rendering / tool cards / composer internals / empty state are out of scope" instruction.
- AS-061's "without losing the thread" is satisfied structurally, not just by convention: `AssistantSidebar` is mounted exactly once in layout.tsx (never remounted by client-side navigation, since layout.tsx doesn't re-render on `/docs/[docId]` navigation — only its `children` do), so the single `useDocAssistant` instance's internal state persists across doc-to-doc navigation by construction. Verified in the test suite by asserting DOM node identity (`toBe`) is preserved across a simulated navigation.

## Out-of-scope work needed
- `--text-quaternary` is documented in CLAUDE.md/this feature's spec as an existing token but has no corresponding CSS custom property or Tailwind utility anywhere in `app/globals.css`'s `@theme` block. A follow-up should either (a) add `--text-quaternary: #62666d` to the token layer following F001's convention and wire up a `text-quaternary` Tailwind utility, or (b) update CLAUDE.md/the design-rules doc to stop referencing a token that was never actually implemented. This F009 worker used `text-muted-foreground` in the one place a quaternary label was called for, to avoid inventing an unwired class.
- Message rendering (bubbles, role styling) — F010.
- Tool call cards — F011.
- Composer internals (input, send, stop button, streaming indicator beyond the current one-line placeholder) — F012.
- Real empty state copy/illustration when `messages.length === 0` and no error — F013 (current placeholder text is a structural stand-in only).
- Proposal accept/reject UI — F015/F016 per F008's own handoff.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Used `text-muted-foreground` instead of a nonexistent `text-quaternary` Tailwind class for the single decorative "No doc open" hint, since `--text-quaternary` has no implementation anywhere in this codebase despite being referenced in CLAUDE.md's design rules — see Out-of-scope work needed above for the suggested follow-up.
AUTONOMOUS_DECISION: Added `useSetBreadcrumb([{ label: title || "Untitled" }])` to `components/docs/markdown-editor.tsx` (one new import, one new hook call, no other changes to that file) to satisfy AS-061's requirement that the context bar shows the current doc's title — the spec's own instruction was to check `BreadcrumbProvider` for this before adding new machinery, and since it wasn't already wired, this is the minimal wiring using the existing established pattern rather than a workaround (e.g. a second client-side doc-title fetch).

## Notes for the next worker
DOM structure F010–F013 must slot into (`components/ai/assistant-sidebar.tsx`, inside `<aside data-testid="assistant-sidebar">`):

```
<aside aria-label="Docs assistant" data-testid="assistant-sidebar">
  <div> {/* context bar, h-12, border-b border-border */}
    <span>{currentDocTitle ?? "Assistant"}</span>
    {!currentDocId && <span data-testid="assistant-sidebar-no-doc-hint">No doc open</span>}
  </div>
  <div> {/* thread region, flex-1 min-h-0 overflow-y-auto p-3 — F010's mount point */}
    {messages.length === 0
      ? <p data-testid="assistant-sidebar-thread-placeholder">...</p>   {/* F013 replaces this */}
      : <div data-testid="assistant-sidebar-message-list-placeholder">...</div>}  {/* F010 replaces this */}
    <div data-testid="assistant-sidebar-tool-cards-placeholder" />       {/* F011's mount point */}
    {error && <p data-testid="assistant-sidebar-error">...</p>}
  </div>
  <div> {/* composer region, border-t border-border p-3 — F012's mount point */}
    {hasApiKey
      ? <div data-testid="assistant-sidebar-composer-placeholder">...</div>  {/* F012 replaces this */}
      : <div data-testid="assistant-sidebar-no-api-key">...</div>}           {/* keep this branch as-is */}
  </div>
</aside>
```

Class conventions to keep:
- Panel borders use `border-border`; internal separators (if F010/F011 add rows) should use `divide-line-row`/`border-line-row`, never `border-border` — see the two-family rule in the spec.
- Font weight: `font-semibold` (590) for the context bar title, `font-medium` (510) or default for everything else — these already resolve to 590/510 via `app/globals.css`'s `--font-weight-semibold`/`--font-weight-medium` theme overrides, so plain Tailwind `font-medium`/`font-semibold` classes are correct, not raw `font-[510]` etc.
- No new `bg-primary` buttons — the workspace already spends its one. Any interactive control F012 adds (send button, stop button) should be `variant="ghost"` or `variant="outline"` from `components/ui/button.tsx`.
- `AssistantSidebar` receives `workspaceId: string` and `hasApiKey: boolean` as props from `layout.tsx` (server-computed via `lib/ai/client.ts`'s `hasApiKey()`) — do not call `hasApiKey()` from a client component; it reads `process.env.ANTHROPIC_API_KEY` and the module's own header comment says it's server-only.
- `useDocAssistant({ workspaceId, currentDocId })` is already called at the top of `AssistantSidebar` — F012 should destructure `send`/`stop`/`isStreaming` from that SAME call (don't call the hook a second time in a child component; it owns its own fetch/AbortController and two instances would double-request).
- The toggle button (`AssistantSidebarToggle`) and the panel (`AssistantSidebar`) share open/closed state via `AssistantSidebarContext` — exported as `useAssistantSidebarContext` if a future feature needs to read/flip `open` from elsewhere (e.g. a keyboard shortcut). It throws if used outside `AssistantSidebarProvider`, matching this codebase's `useMembership`-adjacent "provider is genuinely required" contract for THIS specific context (deliberately not the permissive-null pattern `MembershipProvider`/`BreadcrumbProvider` use, since there's no sensible fallback for "is the assistant panel open").
- No MCP tools were used for this feature — pure client-side UI wiring with no external service or live schema dependency (the AI model/API itself is exercised by F007/F008's route + hook, already built and tested).
