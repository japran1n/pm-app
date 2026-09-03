# F005b: A stable key for the page task type

**Milestone:** M1
**Estimated worker time:** 1–1.5 h
**Depends on:** F005
**Opened by:** the orchestrator, from F005's own documented tradeoff

## Why this exists

`getPortalPages` currently finds page tasks with:

```ts
.ilike("name", "page")
```

`task_types` is a workspace-owned taxonomy with no seeded rows, so F005
had nothing stable to match on and said so honestly in its comments.
But the consequence is that the client-facing Pages view depends on a
human-typed string:

- a workspace that names the type "Sida", "Stranica" or "Page template"
  gets an **empty Pages view with no error** — the worst failure shape
  there is, because nothing looks broken;
- renaming the type later silently empties a client's view;
- the same string match is what F004 was explicitly forbidden to do for
  statuses, for exactly these reasons.

## Assertion IDs covered

- AS-014: The portal Pages view lists every client-visible task of type `page` for the project, ordered by the page order defined by the team.

(F005 owns the ID; this feature makes it hold under renaming and
translation.)

## Scope

1. **Migration** — `task_types.system_key text null`, checked against a
   small closed set (`page`, `qa`, `component`, `content`, `seo`), with a
   unique partial index on `(workspace_id, system_key) where system_key
   is not null`. Nullable: user-created types have no key and never need
   one.
2. **Backfill** — set `system_key = 'page'` on any existing row whose
   name matches page case-insensitively, so today's data keeps working.
3. **Seed on workspace creation** — a `page` type with the key, in
   whatever path creates a workspace's defaults. If no such path exists,
   add the seeding to the same place default statuses are created, and
   say in the handoff where that was.
4. **Query** — `getPortalPages` matches `system_key = 'page'`, with no
   name fallback. A workspace with no keyed page type renders the view's
   empty state, which is honest, rather than matching something by
   accident.
5. **Team UI** — in the task-types settings screen, a type carrying a
   system key shows a small badge explaining that the portal's Pages
   view uses it, and renaming it stays allowed. The label is the point:
   the team should be able to rename freely *because* the key is what
   matters.
6. **Types** — `npm run db:gen-types`.

## Definition of done

- **Primary success test:** integration — renaming the page task type to
  "Sida" leaves the Pages view returning the same rows.
- **Failure test:** a workspace with no keyed page type renders the
  empty state and returns zero rows, rather than matching a
  similarly-named type.
- **Manual verification:** `grep -rn 'ilike("name"' lib/queries/portal.ts`
  returns nothing.
- **Side-effect verification:** F005's tests still pass; the task-types
  settings screen still creates, renames and deletes normally.
