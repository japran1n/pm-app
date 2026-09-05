# F121: Links are created correctly but render inert

**Milestone:** post-portal — **bug fix**
**Estimated worker time:** 1 h
**Assertions:** AS-074, AS-075
**Opened by:** the user, still seeing bare URLs render as plain text
after F120 shipped

## The diagnosis is already done — do not re-derive it

F120 fixed the WRITE path and that half is genuinely working. Verified
by running `autolinkBody` directly against the exact document shape the
composer sends:

    input:  {type:"doc",content:[{type:"paragraph",content:[
              {type:"text",text:"https://www.youtube.com/watch?v=..."}]}]}
    output: same, with marks:[{type:"link",attrs:{href:"https://..."}}]

The link mark IS added and IS persisted (`lib/actions/chat-messages.ts`
line ~518 computes `linkedBodyJson` and the insert uses it, confirmed by
reading the insert call). `link` is also in `ALLOWED_MARK_TYPES`
(rich-text-editor.tsx:715) and `sanitiseHref` accepts `https:`, so the
mark survives sanitisation on the way out.

The bug is entirely in the RENDER path, and it is two independent
things that produce the same symptom:

1. **Not clickable.** `sharedExtensions()` (rich-text-editor.tsx ~line
   166) configures `StarterKit` with `link: { openOnClick: false }`.
   That is correct for `RichTextEditor` (clicking a link while editing
   must not navigate) — but `RichTextRenderer` calls the SAME
   `sharedExtensions()`, so read-only rendered links are inert
   everywhere: chat messages, task comments, task descriptions.
2. **Not visually distinguishable.** `RichTextRenderer` renders into
   `<div className="rich-text-renderer">`, and `app/globals.css` has NO
   rule for `.rich-text-renderer` at all, nor any anchor rule that
   applies here. So the `<a>` element is emitted but inherits body text
   colour with no underline — visually identical to plain text.

Both must be fixed for the user's report to be resolved. Fixing only
one still looks broken.

## Scope

1. Make `openOnClick` depend on render mode rather than being hardcoded
   false for both. `sharedExtensions()` already takes an options object
   (`onReadOnlyChecked`, `getMentionItems`, `assignTaskItemIds`) — add
   an option in the same style and pass it from `RichTextRenderer`
   only. `RichTextEditor`'s behaviour must not change: AS-074 asserts
   both halves.
   - Links opened from read-only content must open safely — use
     `target="_blank"` with `rel="noopener noreferrer"` (Tiptap's Link
     extension has `HTMLAttributes` config for this). Do not invent a
     custom click handler if the extension's own options cover it.
2. Add styling so a link reads as a link in rendered content — colour
   plus underline, in both light and dark theme, using this codebase's
   existing CSS-variable tokens (see `app/globals.css`), not a
   hardcoded hex. Keep it scoped to rendered content
   (`.rich-text-renderer`), not a global `a { }` rule that would
   repaint every link in the app.
3. **Separate, unrelated hygiene fix in the same file (AS-075):**
   rich-text-editor.tsx line ~729 contains RAW control bytes inside a
   regex character class — the source literally contains a NUL byte, so
   `file` reports the file as `data` and **grep silently returns no
   matches for it**, which actively misleads anyone searching this
   codebase (it misled this mission's own investigation). The regex's
   INTENT and behaviour are correct — it strips `\x00-\x1F`, `\x7F` and
   whitespace before the URL-scheme check. Replace the raw bytes with
   the equivalent escape sequences (`/[\x00-\x1F\x7F\s]/g`) so the
   behaviour is byte-for-byte identical but the file is plain text.
   Verify with `file components/editor/rich-text-editor.tsx` reporting
   text, and confirm `sanitiseHref`'s existing tests still pass — this
   is a security-relevant function, so do not "improve" the regex
   beyond making it readable.

## Out of scope

- The autolink write path (`lib/chat/autolink-body.ts`) — verified
  working, do not touch.
- Link preview cards (F120's AS-072) — a separate feature, unaffected.
- Old messages sent before F120 shipped genuinely have no link mark in
  their stored `body_json` and will still render as plain text. That is
  expected and is NOT to be fixed with a backfill migration in this
  feature; note it in the handoff so the user knows old messages stay
  plain.

## Definition of done

- AS-074 tested at the rendered-DOM level: a document containing a link
  mark, passed to `RichTextRenderer`, produces an `<a>` with the right
  href, `target="_blank"`, `rel="noopener noreferrer"`; and the
  editable `RichTextEditor` still has `openOnClick` false.
- AS-075: `file components/editor/rich-text-editor.tsx` reports a text
  type, and `grep -c "openOnClick"` on it returns a non-zero count
  without needing `-a`.
- Existing rich-text/sanitisation tests still pass.
- Manually confirmed in the running app that a newly sent chat message
  containing a URL renders as a visible, clickable link.
