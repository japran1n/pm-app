# F123: Rich text crosses the server-action boundary as a client reference

**Milestone:** post-portal — **blocker**
**Estimated worker time:** 1 h
**Assertions:** AS-079, AS-080
**Opened by:** the user, hitting a runtime error while sending a message
right after F122 shipped

## This is both a regression AND the root cause F122 could not find

**The error, from the running app:**

    Runtime Error (Server)
    Cannot access href on the server. You cannot dot into a temporary
    client reference from a server component. You can only pass the
    value through to the client.
      lib/chat/autolink-body.ts (50:26) @ hasUsableLinkHref
      > const href = mark.attrs?.href;

F122 added `hasUsableLinkHref`, which reads `mark.attrs?.href` on the
server. That read now throws — **and that same inaccessibility is
exactly why the href was missing from the database all along.**

The chain, now fully explained:

1. The client composer hands Tiptap's JSON straight to the `sendMessage`
   server action (`components/chat/message-composer.tsx` ~line 125,
   `bodyJson = useRichEditor ? richValue : docFromPlainText(...)`, passed
   to `onSend`).
2. That object is not plain data. Crossing the server-action boundary,
   its nested `attrs` becomes a temporary client reference rather than a
   serialisable object.
3. Before F122, nothing dotted into it — so the href silently never
   arrived, and the mark was stored as bare `{"type":"link"}`. That is
   the original bug, and it was never a Tiptap bug.
4. F122 started reading `attrs.href` on the server, which turns the
   silent data loss into a hard runtime error.

`toPlainJson` already exists (`lib/comments/rich-text.ts`) and is
applied inside `sendMessage` — but that is **too late**: the value has
already crossed the boundary by then.

## Scope

1. **Serialise on the client, before the boundary (AS-079).** In
   `components/chat/message-composer.tsx`'s `submit()`, convert the
   body to plain JSON before handing it to `onSend`. `toPlainJson` is a
   pure function and is safe to import client-side — reuse it rather
   than writing a second serialiser.
2. **Check every other caller that sends rich text to a server
   action**, not just chat. `lib/actions/comments.ts` and the task
   description path take `bodyJson` the same way — if they pass Tiptap
   JSON straight across, they have the same latent bug and the same
   fix. Fix the ones that do; list what you checked in the handoff,
   including the ones you found already safe and why.
3. **Keep F122's `hasUsableLinkHref` logic** — it is correct once the
   value it reads is real plain data. Do not revert F122 to make the
   error go away; that would restore the original silent-data-loss bug.

## Out of scope

- The renderer's sanitiser, link styling, OG previews — F120/F121, all
  correct.
- A backfill for messages already stored with href-less marks. Note in
  the handoff that they stay plain text.

## Definition of done

- AS-080 verified **end to end in the running app** (dev server is
  already on port 3000 — do not start another): send a message
  containing a bare URL, then confirm all three of:
  a) no runtime error,
  b) the stored `body_json` in the database carries an `href`,
  c) the rendered DOM contains `<a href="...">`.
  Query the DB with `node --env-file=.env` against the REST API
  (`SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`); the supabase MCP
  server is not authenticated here.
- This bug has now survived three features because each one verified
  only part of the chain. Verify all three points above, or say plainly
  in the handoff which you could not.
