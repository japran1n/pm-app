# Codebase Review — Findings

**Scope:** full repository audit (2,723 TS/TSX files, ~83k LOC app code, 135 migrations, 371 test files)
**Date:** 2026-08-28 · **Branch:** `main` @ `5e940c6`
**Audience:** senior backend + senior frontend review

This is a critical review. It deliberately does not list what works well except where
needed for context. Everything below is verified against the code, not inferred.

---

## Verdict up front

The product surface is large and genuinely impressive for its age — task management,
board/list/timeline/calendar views, comments with mentions, notifications, time tracking,
templates, saved views, a client portal, a browser extension, and now chat and docs.

But the codebase has the signature of **breadth prioritized over depth**. Features were
shipped one after another, each one internally reasoned about carefully, but with almost
no cross-cutting engineering: no shared authorization layer, no caching, no transactions,
no queue, no observability, no rate limiting. The result is a system that demos well and
will struggle under real multi-tenant load and real adversarial users.

**Current state of `main`: CI is red.** Lint fails with 4 errors. The test suite reports
**69 failing tests across 36 files** (2,496 passing). Two of the failing files test the
chat feature that was just shipped.

---

## P0 — Security. Fix before anyone else uses this.

### 1. Client-role users have full read/write/delete on every document in the workspace

`docs` and `doc_folders` RLS gates membership on `is_active_workspace_member(workspace_id)`
and nothing else. Current deployed policy (from `20260905020000_docs_project_visibility_rls.sql`,
the migration that supersedes the original):

```sql
create policy docs_select_active_members on docs for select to authenticated
  using (
    public.is_active_workspace_member(workspace_id)
    and (project_id is null or public.is_project_visible_to(project_id))
  );
-- same membership test on insert / update / delete
```

The `project_id` clause is correct (see withdrawn finding #3). The membership test is not:
for workspace-level docs — `project_id is null`, which is most of them — the only gate is
role-agnostic active membership.

`is_active_workspace_member` is **role-agnostic**:

```sql
select exists (select 1 from public.workspace_members wm
  where wm.workspace_id = target_workspace_id
    and wm.user_id = auth.uid() and wm.status = 'active');
```

And the `client` role — the external-customer role that powers the client portal — is an
`active` row in `workspace_members` (`20260902010000_client_role_and_task_client_visibility.sql`).

**Consequence:** an external client with portal access can `GET /rest/v1/docs` directly
against PostgREST and read every internal document in the workspace — architecture notes,
roadmaps, meeting minutes, pricing. They can also `PATCH` and `DELETE` them.

The portal layout's own comment claims the security boundary holds:

> *"This layout is chrome, not a security boundary. RLS is … a client who edits the URL,
> replays a request, or calls PostgREST directly still sees only shared tasks."*

That was true for tasks. It is **not** true for docs. The docs feature was added without
extending the client-isolation model to it.

### 2. Same policies let `viewer` write and delete

`viewer` is read-only everywhere in the application layer (`canWrite()` in
`lib/auth/permissions.ts` excludes it explicitly). The docs RLS does not. A viewer can
delete any document via the API. The UI hides the buttons; the API does not.

### 3. ~~Project-private docs leak to the whole workspace~~ — WITHDRAWN, already fixed

**This finding was wrong. Corrected 2026-08-28.**

The original claim was that docs RLS never checks `project_id`, based on:

```
grep -c is_project_visible_to 20260904010000_docs_system.sql  → 0
```

That grep was accurate but the conclusion was not. A later migration —
`20260905020000_docs_project_visibility_rls.sql`, committed in `3d5a96d` and already applied
to production — rewrote all eight policies to include
`and (project_id is null or public.is_project_visible_to(project_id))`.

Project-scoped visibility works. The audit read the migration that *created* the policies
without checking whether a later one superseded them.

**Methodological note, worth keeping:** in a repo with 135 forward-only migrations and 33 that
`drop policy`, reading any single migration tells you nothing about current state. The
authoritative source is `pg_policies` in the live database, or the migration set replayed in
full. Findings #1 and #2 below were re-verified against the superseding migration and stand.

### 4. AI endpoint is an unmetered spend channel

`app/api/docs/ai-edit/route.ts` — the only check is "is there a session":

- **No rate limiting.** None exists anywhere in the repo (`grep -ri "rate.?limit" lib/ app/` → 0 hits).
- **No input size cap.** `content` is an unbounded string forwarded to Anthropic.
- **No workspace scoping.** The route's own comment concedes this: *"the only authorization check needed is 'is this a signed-in user'."*
- **No streaming**, `max_tokens: 8192` synchronous — will approach Vercel function timeouts on large docs.

One free account in a loop can drain the Anthropic budget. This is the single cheapest
attack in the codebase.

### 5. Architectural: RLS is decorative on the write path

Every mutation in the app runs through `createAdminClient()` — the service-role key, which
**bypasses RLS entirely**. 42 files use it, including query files. In `lib/actions/tasks.ts`
alone there are 60+ `await admin.…` calls and zero user-scoped writes.

RLS is described in comments as "defense in depth". It is not defense in depth — for writes
it is not in the path at all. The real and only authorization boundary is ~90 lines of
hand-rolled preamble copy-pasted into each of the ~20 actions per file.

This has two consequences a reviewer should weigh:

1. **A single forgotten check is a full authorization bypass.** There is no backstop.
2. **The security model is inconsistent across features.** Tasks/comments bypass RLS and
   check in code. Docs rely on RLS and check nothing in code. Chat does both. An auditor
   must read every file individually — there is no invariant to verify once.

The repo's own history shows the cost: **16 of 135 migrations are post-hoc security patches**,
including `fix_create_notification_spoofing`, `fix_write_task_activity_entry_forgery`,
`fix_comment_edit_trigger_authorship_guard`, and `fix_create_notification_system_bypass`.
A 17th (`fix_channel_members_rls`) was added during this review — the `channel_members`
SELECT policy recursed into itself and made the entire chat feature return
`42P17 infinite recursion` for every user in production.

**Recommendation:** pick one model and enforce it. Either
(a) route reads/writes through the user-scoped client and make RLS the single boundary, or
(b) keep the admin client but funnel every action through one `withAuthz(...)` wrapper that
cannot be forgotten. The current halfway state is the worst of both.

---

## P1 — Correctness bugs

### 6. Unread-count query fetches every message in every channel, and returns wrong counts

`lib/queries/chat.ts`, `getWorkspaceChannels`:

```ts
supabase.from("messages").select("channel_id, created_at")
  .in("channel_id", channelIdList)
  .is("deleted_at", null)
  .gt("created_at", new Date(0).toISOString()) // base filter; refined per-channel below
```

`new Date(0)` is 1970-01-01. That predicate matches **every row**. The comment two lines
above claims *"Unread messages: only rows newer than the caller's last_read_at per channel …
filter server-side"* — the filter is not server-side, it happens in JS afterward.

So rendering the chat sidebar fetches every message the user can see, on every page load.
It also silently returns **wrong unread counts** once the result crosses PostgREST's
`max-rows` ceiling, because the truncation happens before the JS filter.

### 7. "Latest message per channel" is provably incorrect

Same function:

```ts
.order("created_at", { ascending: false })
.limit(channelIdList.length * 2)
```

with the comment: *"the limit (channelIds × 1) means we get at most one row per channel
after sorting."* That reasoning is false. The rows are ordered globally, not partitioned
per channel. If one busy channel owns the most recent `2 × N` messages, every other channel
gets no `lastMessageAt` at all and drops out of the sidebar's activity sort.

Both of these are the kind of finding worth showing the seniors directly: **a confident
comment asserting a property the code does not have.** That pattern recurs — the comments
are dense (27% of `lib/actions/tasks.ts` is comment lines) and are frequently reasoning
about intent rather than describing behaviour.

Note: `unit/chat-workspace-channels-unread-count.test.ts` is currently failing (3 tests).
The suite caught this; it was shipped anyway.

### 8. Multi-step writes are not atomic

There are 130 `insert`/`update`/`delete` calls in `lib/actions/` against only 15 RPCs.
Most multi-step mutations are sequential round-trips with no transaction. Example —
`setTaskAssigneesCore` in `lib/actions/tasks.ts`:

```ts
if (toRemove.length > 0) { await admin.from("task_assignees").delete()… }
if (toAdd.length    > 0) { await admin.from("task_assignees").insert()… }
```

If the delete succeeds and the insert fails (network blip, constraint violation), the task
is left with assignees silently removed and none added. The error path returns a generic
"Something went wrong" and does not roll back. The same shape appears in status
reassignment, checklist reordering, and template application.

Supabase supports this correctly via `plpgsql` functions — and this codebase already knows
how (`stop_timer_atomic`, `reassign_and_delete_project_status`, `apply_status_template`).
The pattern just wasn't applied consistently.

### 9. Notification fan-out is serial, in the request path

```ts
for (const recipient of recipients ?? []) {
  await createNotification(supabase, { … });
}
```

This appears in 8 places. Assigning a task in a workspace with 40 watchers is 40 sequential
DB round-trips the user waits on. There is no queue, no batch insert, no background job.
The whole block is wrapped in `try/catch` and logged as `non-fatal` — **120 occurrences of
"non-fatal" swallowed errors** across `lib/`. When notifications stop being delivered, no
alarm fires and nothing surfaces to the user.

### 10. CI does not build, and tests run against production

`.github/workflows/ci.yml` runs typecheck → lint → vitest → Playwright. There is **no
`next build` step**, so a build-breaking change is only discovered by Vercel after merge.

More seriously: the CI secrets are `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SECRET_KEY` for
the **single Supabase project this app uses in production**. There is no staging project.
Integration tests create and mutate real rows in the production database on every push.
This is also why the suite takes **8m 25s** — nearly every test is a remote network round-trip.

---

## P2 — Architecture and scale

### 11. No caching layer of any kind

```
unstable_cache:        0 uses
React cache():         0 uses
export const revalidate: 0 uses
export const dynamic = "force-dynamic": on both root layouts
Suspense:              0 uses
```

Every workspace route is force-dynamic, and pages issue **5–8 sequential `await`s** before
rendering (timeline: 8, calendar: 7, projects: 6, my-tasks: 6). Nothing is deduplicated —
`from("workspaces")` appears in 40 route files, so a layout and its page each re-query the
same workspace row on the same request.

With no `Suspense` anywhere, there is no streaming: the browser gets nothing until the
slowest query in the chain resolves. At typical Supabase round-trip latency this is
several hundred ms of avoidable TTFB on every navigation.

**Fixes are cheap and high-leverage:** wrap `getWorkspaceBySlug` etc. in `React.cache()`,
`Promise.all` the independent awaits, and put `<Suspense>` around the slow panels.

### 12. The App Router is being used as a Pages Router

**187 files carry `"use client"` against 179 total components.** Essentially the entire
component tree is client-side. Server Components, the main reason to be on this framework,
are doing almost nothing — data is fetched on the server and then handed to a client tree
that ships all of its own JS to the browser anyway.

A senior frontend reviewer will ask why Next 16 was chosen if the RSC boundary is pushed to
the leaves. Related: `useOptimistic` is used **zero** times despite this being a
mutation-heavy UI with a Server Actions backend — which is exactly the pairing it exists for.

### 13. Unbounded queries; pagination built but not wired up

`lib/queries/tasks.ts` contains **no `.limit()` and no `.range()`**. The board and list
views fetch every task in a project. This is fine at 50 tasks and a serious problem at 5,000
— both for the query and for the client-side render, since `board.tsx` (1,134 lines) sorts
and groups the full set in JS on every render.

Chat is the inverse: `getChannelMessages` **does** accept `{ before, limit }`, but no UI
calls it. `grep -rn "loadMore\|hasMore\|fetchNextPage" components/chat/` → nothing. Users
are permanently capped at the last 50 messages with no way to reach history.

### 14. No observability

- **405** `console.*` calls are the entire logging strategy.
- No Sentry, OpenTelemetry, Datadog, or structured logger. Several comments say
  *"Sentry-equivalent per this repo's convention"* — the convention is `console.error`,
  which on Vercel means unstructured, unsearchable, unalertable text.
- Combined with 120 `non-fatal` swallowed catches, a broad class of failures is invisible.

You cannot operate a multi-tenant SaaS this way. This is the first thing a backend hire
will want to change.

### 15. `lib/actions/tasks.ts` is 5,111 lines

20 exported Server Actions, each opening with a near-identical ~90-line preamble:
parse with Zod → `getUser()` → `createAdminClient()` → load task → resolve workspace →
`requireActiveMembership` → `canWrite` → `isProjectVisibleToCaller` → mutate →
`revalidatePath` ×26 → fan out notifications.

That preamble is duplicated 16 times in this file and again across ~40 other action files.
It is the single largest source of both bulk and risk in the codebase: every new action is
an opportunity to omit one of the seven steps, and there is no type-level or test-level
mechanism that would catch the omission.

A `withTaskAuthz(taskId, { require: "write" })` higher-order function would delete an
estimated 2,000+ lines and make the authorization invariant checkable in one place.

---

## P3 — Maintainability

### 16. The codebase is annotated for an audience that no longer exists

- **2,318** references to `F###` feature IDs
- **2,833** references to `AS-###` assertion IDs
- 50 files pointing at `docs/*-plan.md`

Comments read like: *"F128 (AS-216, AS-217): viewers are read-only (canWrite deliberately
does not exclude guest — see its doc comment …)"*. These identifiers resolve only to
`missions/` handoff files. For a new engineer they are noise with a high confidence tone —
worse than no comment, because they look authoritative.

Combined with 27% comment density in the largest files, the practical effect is that
reading the code means reading three times as much text as there is logic, much of it
narrating decisions rather than describing behaviour — and, as items 6 and 7 show,
occasionally describing behaviour that isn't there.

### 17. Migration churn

135 migrations in ~2 weeks. 33 of them `drop policy`, i.e. rework of previously-shipped
security rules. 16 are named `*fix*`/`*gap*`. Two migrations were even given the same
timestamp (`20260904070000`) and had to be renamed before they could be pushed.

There is no squashed baseline schema, so understanding the current shape of any table means
replaying 135 files in order.

### 18. Six stale feature branches

`chore/optimization-pass`, `feat/client-portal`, `feat/design-system-gg3`,
`feat/estimates-view`, `feat/m3-estimates`, `feat/password-auth` — all diverged from `main`,
only one pushed to origin. Some of this work appears to have been re-implemented on `main`
directly.

---

## What to fix, in order

| # | Item | Effort | Risk if skipped |
|---|---|---|---|
| 1 | Docs RLS: add role checks (project-visibility already done) | 1h | External clients read/delete internal docs |
| 2 | Rate-limit + size-cap + workspace-scope `/api/docs/ai-edit` | 2h | Unbounded API spend |
| 3 | Fix the two `getWorkspaceChannels` query bugs | 2h | Wrong unread counts, full-table scans |
| 4 | Get `main` green (69 tests, 4 lint errors) | 1d | No signal from CI at all |
| 5 | Stand up a staging Supabase project; point CI at it; add `next build` | 1d | Tests mutate production |
| 6 | Wrap multi-step writes in `plpgsql` RPCs | 2–3d | Silent data loss |
| 7 | Add Sentry + structured logging; stop swallowing errors | 1–2d | Blind in production |
| 8 | `React.cache()` + `Promise.all` + `Suspense` on hot routes | 2–3d | Slow every page |
| 9 | Extract `withAuthz` wrapper; collapse the preamble | 1w | Next auth bypass is a matter of time |
| 10 | Paginate tasks; wire chat's existing pagination to the UI | 3d | Breaks at real data volume |
| 11 | Decide on one security model (RLS vs. app-layer) and enforce it | 1–2w | Permanent per-file audit burden |

Items 1–3 are same-day and should not wait for a review meeting.

---

## Framing for the conversation

Two things worth saying out loud when presenting this:

**The good instinct that's visible.** Someone thought hard about authorization semantics —
the six-role model (`owner/admin/member/viewer/guest/client`), project visibility, guest
scoping, and client isolation are genuinely well-reasoned, and the `lib/auth/permissions.ts`
predicates are clean. The extension API route is properly secured and honestly documented.
The problem is not that the thinking was absent; it's that it was re-derived per feature
instead of factored into something enforceable.

**The gap is engineering, not features.** Nothing on this list is about missing
functionality. It's transactions, caching, rate limiting, observability, pagination, and a
single authorization seam — the cross-cutting infrastructure that a product acquires when
it stops being a prototype. That's a coherent, finite body of work, and it's the right
thing to hand to two senior engineers.
