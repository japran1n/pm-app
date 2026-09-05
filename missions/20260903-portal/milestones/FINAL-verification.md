# FINAL verification — mission 20260903-portal

**YES — this mission is complete. No blocker survives.**

Scope: only the three fixes named in the gate request (F024b, F025d, F025e), verified against
`missions/20260903-portal/milestones/F024-preview-review.md`. No subagents spawned; no full
suite run (one is in progress separately). Four targeted unit files were executed.

---

## 1. F024b — can a previewing admin still act as the client? **No.**

I tried each of the four routes the request named.

**`.rpc()` writes — not covered structurally, but no reachable path is unguarded.**
`wrapPreviewClientReadOnly` (`lib/supabase/server.ts:108-136`) only proxies `from()` and only
intercepts `insert/update/upsert/delete`. `.rpc()` passes straight through — the file says so at
lines 62-73, and the reason given is correct and load-bearing: portal *read* paths
(`project_hours_client`, `get_open_task_counts`) call RPCs through the same client, so a blanket
RPC block would break reads. Every write RPC is therefore reached only through an action whose
FIRST statement is `assertNotPreview()`:
`lib/actions/portal-approval.ts:131` (approvePortalTask), `:186` (requestPortalTaskChanges),
`:332` (decideApproval — the path that previously had no application-level auth at all),
`lib/actions/portal-project-records.ts:32` (flag_assumption_atomic),
`lib/actions/portal-deliverables.ts:70` (mark_deliverable_delivered_atomic),
`lib/actions/comments.ts:103` (addComment), `lib/actions/client-requests.ts:183` and `:231`.
`accept_client_request_atomic` is a team-side triage RPC, not reachable from any `/portal` surface.

**Storage uploads — not covered structurally, guarded explicitly.** The only portal upload is
`deliverPortalDeliverable`, and its `assertNotPreview()` at `portal-deliverables.ts:70` runs before
the file is even read from the FormData, so neither the `task-attachments` object nor the state
transition can occur.

**Admin-client writes — not covered structurally, guarded explicitly.** Same eight actions; the
admin client is only constructed after the guard returns.

**Any ninth write path?** Enumerated exhaustively rather than trusted:
`grep -rn "lib/actions" components/portal` and the `@/components/*` imports of every file under
`app/(portal)` yield exactly these mutating entry points — the eight guarded actions plus
`startClientPreview`/`exitClientPreview`/`signOut` (preview-lifecycle, correct by design) and three
read-only signed-URL actions. There are no `route.ts` handlers under `app/(portal)`; the six route
handlers in the app live at `/api/*`, `/dev-login`, `/auth/*`, none of which the `path: "/portal"`
preview cookies are ever sent to. No `<form action=>` in the portal posts anywhere else.

The structural layer's claimed value does hold for the case it claims: a future
`supabase.from(x).insert(...)` in a new portal action is refused with no guard to remember
(`blockedPreviewWrite` returns a thenable proxy, so `.insert(x).select().single()` and
`.delete().eq(...)` both resolve to the refusal rather than throwing on chain).

Residual, non-blocking, recorded for completeness: `deleteComment`/`editComment`
(`lib/actions/comments.ts:478`, `:1030`) take the actor from `createClient().auth.getUser()` and
mutate through the admin client, so under preview they would attribute to the client. They are not
imported by any portal component and are reachable only by hand-crafting a Server Action ID against
a `/portal` URL — and the actor is an admin who holds those rights on `/w/*` anyway, so this is
misattribution of an already-permitted act, not escalation.

## 2. F024b secondary fixes — all three hold.

- **Sign-out.** `lib/actions/auth.ts:96-107`: under preview, `signOut()` never calls
  `supabase.auth.signOut()` at all. It expires the four `path:"/portal"` cookies and redirects to
  `/w/<slug>/preview-as-client`. The real client's Supabase session is untouched; the previewer
  stays signed in as themselves. Team callers pass no `workspaceSlug` and never carry the cookies,
  so their branch is byte-identical. Covered by `tests/unit/portal-preview-signout.test.ts`.
- **Audit fail-closed at mint.** `lib/actions/portal-preview.ts:161-183`: the RPC is called
  directly, not via `writeAudit()` (which swallows errors at `lib/activity/audit.ts:61-78`), and
  `auditError` returns `{ ok: false }` *before* any `cookieStore.set`. No cookie can exist without a
  row. The per-entry write in the layout (`layout.tsx:126-140`, action `portal.preview_entered`,
  through `createRealSessionClient()` so `auth.uid()` is the previewer and not the impersonated
  client) is deliberately best-effort and documented as such at lines 120-125; a failed re-entry row
  logs and renders. That is a documented degradation of a live, already-audited session, not an
  unaudited preview.
- **TTL expiry.** All four cookies are set in one response with the same
  `maxAge = PREVIEW_SESSION_MAX_AGE_SECONDS` (30 min, `portal-preview.ts:46-64`), so they expire
  together — there is no window where `isPortalPreview()` disagrees with what the banner reads.
  On expiry the browser stops sending them; `createClient()` falls back to the previewer's own
  `/`-scoped session (path `/` matches `/portal/*`), so the request degrades to **the admin's own
  session, not to no session** — and the portal layout then resolves their real role, fails
  `canViewClientPortal`, and redirects them to `/w/<slug>` (`layout.tsx:86-90`). Clean exit, no
  half-authenticated portal, and re-entry mints a new session and a new audit row.

## 3. F025d and F025e — both hold.

**F025d** (`supabase/migrations/20261022010000_f025d_projects_key_insert_guard.sql`). The bypass is
genuinely per-column on INSERT: observing the flag sets `v_key_bypass := true` (line 177) and the
*only* consequence is `v_named_cols := v_named_cols || array['key']` (lines 181-183). The early
`return new` whole-row bypass is confined to `TG_OP = 'UPDATE'` (lines 174-176), i.e. F025c's
`task_counter` bump on a different statement. The flag is self-consumed by `set_config(..., 'off')`
at line 173 the instant it is read, so it cannot leak into a later trigger.
Consequently, on a client INSERT: `baseline_frozen_at` is in `v_writer_cols` (line 114) → sets
`v_writer_touched` → rejected at lines 268-271 for a client/viewer; `portal_enabled` is in
`v_owner_admin_cols` (line 115) → rejected at 273-276; `task_counter` is named nowhere, so it falls
into the generic `to_jsonb(new) - v_named_cols` diff against the pg_attrdef default row and is
rejected at 220-224. Authenticated member creation succeeds because `key` — and only `key` — is
exempted for that one invocation, and a caller-supplied `key` never reaches
`assign_project_key()`'s write path so it stays rejected.

**F025e.** The portal's site page imports only the double-guarded siblings —
`getClientVisiblePortalLinks` / `getClientVisiblePortalAccounts` (`lib/queries/project-site.ts:162`,
`:187`, each adding `.eq("client_visible", true)` on top of RLS) and `getClientVisibleDocs`
(`lib/queries/docs.ts:239`). The account sibling also omits credential columns from its `select`.
Sweeping every `@/lib/queries` import under `app/(portal)` shows no portal route calling the
unfiltered `getProjectLinks`, `getProjectAccounts`, `getAllDocs` or `getDocById`; those remain
team-facing only.

---

## Assertions touched by these three fixes

| ID | Verdict | Reason |
|---|---|---|
| AS-052 | PASS | Preview session cannot write on any reachable portal path: Layer A refuses all table mutations structurally, Layer B guards all eight RPC/comment/storage actions first. |
| AS-053 | PASS | Preview cannot start without an audit row (fail-closed before cookies are set); each entry writes `portal.preview_entered` as the previewer, best-effort and documented. |
| AS-049/050/051/054 | PASS | Portal site reads go through `client_visible = true` siblings; no unfiltered query remains on a portal route. |
| (F025d, no assertion) | PASS | Bypass is per-column on INSERT; `baseline_frozen_at`, `portal_enabled`, `task_counter` all still rejected for a client; member project creation works. |

## Commands run

Per the gate's instruction, the full suite was NOT run (one is in progress separately). Only:

```
npx vitest run tests/unit/f024b-preview-write-guard.test.ts \
  tests/unit/assert-not-preview-guard.test.ts \
  tests/unit/portal-preview-signout.test.ts \
  tests/unit/portal-preview-action.test.ts

 Test Files  4 passed (4)
      Tests  35 passed (35)
   Duration  265ms
```

Everything else above is established by reading the code and by exhaustive greps of
`components/portal`, `app/(portal)`, `assertNotPreview` call sites, and `route.ts` locations.
