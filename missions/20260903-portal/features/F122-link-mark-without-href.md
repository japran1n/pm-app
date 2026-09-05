# F122: Link marks are stored without an href, so every link is dropped on render

**Milestone:** post-portal — **bug fix**
**Estimated worker time:** 1–2 h
**Assertions:** AS-076, AS-077, AS-078
**Opened by:** the user, links still rendering as plain text after both
F120 and F121 shipped

## The investigation is done. Do not re-derive it.

F120 fixed autolinking. F121 fixed link styling and clickability. Both
were real bugs, both are genuinely fixed — and links STILL render as
plain text, because there is a third, separate bug underneath.

**Hard evidence, taken from the live database, not inferred:**

The stored `body_json` for a message containing a URL is:

    {"type":"doc","content":[{"type":"paragraph","content":[
      {"text":"https://www.youtube.com/watch?v=W4drPiXwlyc",
       "type":"text","marks":[{"type":"link"}]}]}]}

The link mark is `{"type":"link"}` — **no `attrs`, no `href` at all.**

Rendered DOM for that exact message (captured from the running app):

    <p>https://www.youtube.com/watch?v=W4drPiXwlyc</p>

No `<a>` element. And that is CORRECT behaviour from the sanitiser:
`sanitiseMark` (rich-text-editor.tsx ~line 750) calls
`sanitiseHref(m.attrs?.href)`, gets `undefined`, and drops the mark
entirely rather than rendering an href-less anchor. That guard is right
and must NOT be weakened — see AS-078.

**Why F120's autolinker never repairs it:** `lib/chat/autolink-body.ts`
guards with

    if (node.marks?.some((m) => m.type === "link")) return [node];

meant as "never re-wrap already-linked text". But a href-less
`{type:"link"}` mark satisfies that check, so autolinkBody skips exactly
the nodes that most need fixing. The URL text is left with a mark that
carries no destination, and the sanitiser then correctly discards it.

**Confirmed by timing, so this is not a stale-code artefact:** F120
landed at 13:56 UTC. A message sent at 15:01 UTC — 65 minutes later,
through the fixed code path — still stored `{"type":"link"}` with no
href.

## Scope

1. **Fix the skip guard in `lib/chat/autolink-body.ts` (AS-076,
   AS-077).** Skip a text node only when its existing link mark carries
   a usable href. A link mark with no href — or with an href that is not
   a string / is empty — must be treated as unlinked, so the node gets
   linkified normally and ends up with a real href.
   Take care not to end up with two link marks on one node: repair or
   replace the existing mark rather than appending a second one.

2. **Find why the client sends a href-less link mark in the first
   place.** This is the true origin and item 1 alone only compensates
   for it. The composer path is
   `components/chat/message-composer.tsx` line ~125
   (`bodyJson = useRichEditor ? richValue : docFromPlainText(...)`),
   where `richValue` comes from `RichTextEditor`'s `onChange`. Trace
   where the href is lost between Tiptap's own autolink applying the
   mark and the JSON that reaches `sendMessage`. Fix it at that point
   too if it is ours to fix. If it turns out to be Tiptap's own
   behaviour and not something this codebase drops, say so explicitly
   in the handoff with the evidence — do not guess, and do not paper
   over it silently with item 1.

3. **Do not weaken the sanitiser (AS-078).** Dropping a link mark with
   no usable href is correct security behaviour and stays. The fix
   belongs upstream, where the href goes missing — never by inventing
   an href at render time from the link's own text.

## Out of scope

- Link styling / clickability — F121, already correct once an `<a>`
  actually exists.
- OG preview cards — F120's AS-072, unaffected.
- Messages already stored with href-less link marks stay plain text.
  A backfill is NOT part of this feature; note it in the handoff so
  the user knows old messages need re-sending to pick up a link.
- `components/command/*`, sidebar, portal — untouched.

## Definition of done

- AS-076/AS-077 tested against the exact real-world shape above: a doc
  whose text node already carries `{"type":"link"}` with no attrs must
  come out of `autolinkBody` with a link mark carrying the correct
  href, and exactly one link mark.
- AS-078 tested: a stored href-less link mark renders with no anchor
  and no fabricated href.
- Verified end-to-end in the running app (a dev server is already on
  port 3000 — do not start another): send a message containing a bare
  URL, then confirm BOTH that the stored `body_json` carries an href
  AND that the rendered DOM contains an `<a href=...>`. Checking only
  one of the two is what let this bug survive two previous features.
