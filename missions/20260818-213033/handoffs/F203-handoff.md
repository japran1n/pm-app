# Handoff: F203 — @mention picker in comments

## Status
COMPLETE

## Assertions covered
AS-371: PASS — `test_AS_371_empty_query_returns_full_member_list`, `test_AS_371_renders_a_listbox_with_every_member_when_opened`, `test_AS_371_escape_dismisses_without_inserting` (tests/unit/mention-extension.test.tsx)
AS-372: PASS — `test_AS_372_filters_by_case_insensitive_substring_match`, `test_AS_372_no_match_returns_an_empty_list`, `test_AS_372_narrowed_list_renders_only_matching_options`, `test_AS_372_arrow_keys_move_the_highlighted_selection`, `test_AS_372_arrow_up_wraps_to_the_last_item` (tests/unit/mention-extension.test.tsx)
AS-373: PASS — `test_AS_373_selecting_an_option_calls_command_with_the_chosen_member`, `test_AS_373_mention_node_renders_as_a_chip_with_the_current_resolved_name`, `test_AS_373_mention_resolves_the_CURRENT_name_not_a_stored_one`, `test_AS_373_unresolvable_id_falls_back_to_the_raw_id_rather_than_blank` (tests/unit/mention-extension.test.tsx)

## Files changed
components/editor/mention-extension.ts (new)
components/editor/mention-list.tsx (new)
components/editor/rich-text-editor.tsx (modified)
components/task/comment-list.tsx (modified)
tests/unit/mention-extension.test.tsx (new)

## Commands run
`npx vitest run tests/unit/mention-extension.test.tsx` (0 — 12/12 passed)
`npx tsc --noEmit` (0)
`npx eslint components/editor/mention-extension.ts components/editor/mention-list.tsx components/editor/rich-text-editor.tsx components/task/comment-list.tsx tests/unit/mention-extension.test.tsx` (0)
`npm run test` (0 — 1450 passed, 18 pre-existing failures, all in tests/integration/{invite-member,open-blockers,perf-budget,workspace-role-expansion}.test.ts — unrelated to editor/comments/mentions, DB-latency/timeout related, confirmed present before this change touched no files in those suites)

## Decisions made
- **No new client-side member query.** `lib/queries/members.ts` was left untouched. Per the clarified spec's "simpler option, no new dependency, no second source of truth" rule, the suggestion source reuses the `members`/`CommentListMember[]` list `comment-list.tsx` already receives as a server-fetched prop (same data flowing into `CommentReactions`/author-resolution already). A new `mentionSuggestions` array (`{id, label}[]`, derived from `members`) is passed into both `RichTextEditor` and `RichTextRenderer`.
- **Storage: id only, never a label.** `mention-extension.ts`'s `command` handler writes `{ type: "mention", attrs: { id } }` — no `label` attr. `sanitiseNode`'s mention branch in `rich-text-editor.tsx` also strips any `label` key that might arrive in untrusted stored JSON, so there's exactly one path (`resolveMentionLabel(getItems(), id)`) that ever produces display text, called fresh on every `renderHTML`/`renderText` pass. This is what the spec's Notes flagged as required for a future AS-377.
- **Extension only registers when `mentionSuggestions` is passed.** `sharedExtensions({ getMentionItems })` omits the Mention extension entirely when the caller doesn't pass anything, so any other `RichTextEditor`/`RichTextRenderer` usage in the codebase (e.g. task descriptions) is unaffected — `@` still types as a literal character there.
- **Filtering is case-insensitive substring match** on the member's resolved label (name, falling back to email, falling back to id) — the same convention `lib/queries/search.ts` already uses elsewhere in the app.
- **Keyboard contract implemented via `MentionList`'s imperative `onKeyDown` handle**, matching Tiptap's real `SuggestionOptions.render().onKeyDown` lifecycle (`mention-extension.ts`'s `render()` forwards `props.event` from the live Suggestion plugin straight into it) — arrows move the highlight, Enter selects, Escape dismisses without inserting (verified via `component?.ref` in `onKeyDown`, and `unmount()`/`destroy()` are called without invoking `command`).
- Positioning uses Tiptap 3.30's built-in `props.mount()` (Floating UI is bundled in `@tiptap/suggestion` 3.x) — no new `tippy.js`/positioning dependency was added, matching `package.json`'s existing dependency set.

## Out-of-scope work needed
- AS-377 (a future feature per the spec's own Notes) — sending an actual notification when a mention is inserted — was explicitly NOT touched; this feature only makes the id-based storage that AS-377 depends on possible.
- No Playwright coverage was added. Tiptap/ProseMirror's contenteditable typing pipeline is not reliably simulable in jsdom (this is the codebase's own established position — see `tests/unit/rich-text-editor.test.tsx`'s doc comment, and no prior editor feature — AS-306, AS-311, AS-312 — has Playwright coverage either). Unit tests exercise the exact same non-mocked units (`filterMentionItems`, `MentionList`'s real keyboard handle, `RichTextRenderer`'s real render pipeline) that the live Suggestion plugin calls, rather than a mocked reimplementation. If the mission wants a live-browser check, a small addition to an existing comment-related Playwright spec (there is none yet for comments) covering "type @, see popup, arrow+Enter, comment body shows chip" would be the natural follow-up feature.

## Blockers
(none — Status is COMPLETE)

## Autonomous decisions
AUTONOMOUS_DECISION: Reused the existing `members` prop already threaded through `comment-list.tsx` as the mention suggestion source instead of adding a new project-scoped query in `lib/queries/members.ts`, per the clarified spec's "simpler option, no new dependency, no second source of truth" default. The existing `members` list is already scoped correctly (workspace members of the task's project's workspace, per `lib/queries/members.ts`'s own doc comment), so this doesn't widen visibility beyond what commenters can already see (author names, reactions) in the same view.
AUTONOMOUS_DECISION: Positioned the popup via Tiptap 3.30's built-in `SuggestionProps.mount()` (Floating UI already bundled) rather than adding `tippy.js`, since no positioning library was already a dependency and the built-in mount satisfies the requirement with zero new packages.

## Notes for the next worker
- `components/editor/mention-extension.ts` exports `filterMentionItems` and `resolveMentionLabel` as pure, independently-testable functions — reuse these directly if a future feature (e.g. AS-377's notification-on-mention) needs to walk a document's mention nodes or re-derive who was mentioned.
- `RichTextEditor`/`RichTextRenderer` both gained an optional `mentionSuggestions?: MentionSuggestionItem[]` prop (`{id, label}[]`). Any other call site that wants `@`-mentions (e.g. task descriptions, if a future feature wants that) just needs to pass this prop with the right scope of people — no other wiring required.
- MCP usage: none (per the feature spec's own "MCP at run: none" note — this feature touches no live external service state).
