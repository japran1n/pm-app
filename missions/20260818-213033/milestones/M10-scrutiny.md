# M10 — Foundation v2 & identity primitives — Scrutiny report

_Mission 20260818-213033 · Milestone M10 · Features F118–F125 · Assertions AS-201–AS-214_
_Reviewed at HEAD `8454641`. Range reviewed: `46a1bfa..HEAD` (the task brief named `a48d1e3..HEAD`, which covers only F124–F125; the full milestone starts at F118, so the wider range was used)._
_Read-only review. Nothing was modified, fixed, or committed._

---

## Verdict table

| Assertion | Verdict | Reason |
|---|---|---|
| AS-201 | **PASS** | `on_auth_user_created` trigger on `auth.users` INSERT + a backfill covers every sign-in path; proven empirically by tests that create users and find profile rows with no manual insert. |
| AS-202 | **FAIL** | The display-name settings page is unreachable — nothing in the app links to `/w/<slug>/settings/profile`. A user cannot set a display name without typing the URL. |
| AS-203 | **FAIL** | Next's default 1 MB Server Action body limit is not raised, while the app's own avatar limit is 2 MB. Every avatar between 1 MB and 2 MB 413s before the action runs, and the form has no `catch`, so the rejection is unhandled — no toast, no revert. |
| AS-204 | **PASS** | Colour is deterministic per user id; all eight claimed WCAG ratios independently recomputed and correct (4.71–6.29 : 1, all ≥ 4.5). |
| AS-205 | **FAIL** | The message names the limit and is single-sourced from `MAX_AVATAR_SIZE_BYTES`, but a >2 MB file dies at the 1 MB HTTP body limit before the validator runs, so the user never sees it. |
| AS-206 | **FAIL** | Rejection is based solely on client-declared `File.type`. No magic-byte sniffing. Renaming `evil.exe` → `evil.png` is accepted and stored; the feature's own AS-203 test stores 8 arbitrary bytes as `image/png`. |
| AS-207 | **FAIL** | Due-date *text* is still formatted in ambient (server/browser) time in `task-card.tsx:64` and `task-list-table.tsx:64`. Reproduced: `due_date "2026-08-20"` renders "Aug 19, 2026" under `TZ=America/New_York`. |
| AS-208 | **PASS** | `profiles_update_self` has both `using` and `with check (id = auth.uid())`; no INSERT/DELETE policy; the Server Action takes no client-supplied id. Verified by tests using real authenticated (non-service-role) clients. |
| AS-209 | **PASS** | `shares_workspace_with()` requires `status = 'active'` on both sides; an invited-but-not-active member correctly neither sees nor is seen. Verified with a real member session. |
| AS-210 | **FAIL** | `shares_workspace_with()` has no `workspaces.deleted_at is null` join, and `deleteWorkspace` leaves `workspace_members` rows `active`. Two users whose only shared workspace was deleted keep permanent, unrevocable read access to each other's profile. |
| AS-211 | **PASS** | A three-segment `ToggleGroup` (light/dark/system) with an accessible name; verified live by a passing Playwright test. |
| AS-212 | **PASS** | `next-themes` localStorage persistence plus a `storage` event listener; reload and new-tab both verified live by a passing Playwright test. |
| AS-213 | **PASS** | Mechanism verified structurally: `suppressHydrationWarning` on `<html>`, `next-themes@0.4.6` blocking inline script as the first node in `<body>`, Tailwind v4 `@custom-variant dark (&:is(.dark *))` matching `attribute="class"`. See the major test-quality finding below — no test measures first paint. |
| AS-214 | **FAIL** | The only test is a `readFileSync` + regex over source text. It would pass if `UserAvatar` returned `null`. No test in the repo exercises the assertion; the repo has no DOM test environment at all. |

**7 PASS · 7 FAIL · 0 INCONCLUSIVE**

---

## FAIL items

### AS-202 — display-name page unreachable · **blocker**

`app/(workspace)/w/[workspaceSlug]/settings/profile/page.tsx` exists and works, but a repo-wide grep for `settings/profile` returns only the route's own files. `components/nav/app-sidebar.tsx:35-39` hard-codes the nav list (Dashboard, Projects, Search, Time, Members) with no Profile entry, no Settings parent, and no user/account menu; the sidebar footer holds only the theme toggle and Sign out. The "shown instead of email everywhere" half of AS-202 is genuinely well-built — every person-render surface (members list, time table, assignee filters/pickers, list table, task detail sheet, comments, attachments, avatar labels, board cards) resolves through `resolvePeople` in `lib/queries/people.ts`, with no raw-email primary label remaining — but the "a user can set their display name" half is not reachable by clicking.

Related lower-severity findings on the same feature:
- **major** — `lib/actions/profile.ts:174-177` claims `profiles_update_self` is a second line of defense if the `.eq("id", user.id)` were ever broken. It is not: line 203 uses `createAdminClient()`, which bypasses RLS by design. The comment will mislead the next reader. The admin client is not needed here — the caller's own session client is permitted to make exactly this update.
- **major** — the timezone validator (`lib/validation/profile.ts:76-83`) is an `Intl.DateTimeFormat` try/catch, not an IANA-list check. It accepts `"+05:00"`, `"-0700"`, `"EST5EDT"`, and lowercase `"america/new_york"` — none of which the Select can render (blank field) and some of which Postgres `AT TIME ZONE` may reject inside `get_overdue_count`, which reads this column. `updateProfile` is a directly-callable Server Action, so the Select is not a gate.
- **minor** — `settings/members/page.tsx:166-168` and `time/page.tsx:207-209` now render the email local part stacked over the full email (the same string twice) for users with no display name, because the fallback chain changed under a branch nobody re-checked.
- **minor** — once a display name is set, `resolvePeople` stops populating `email` (`lib/queries/people.ts:94`), so an admin can no longer see which address a member corresponds to in the members list.
- **minor** — no uniqueness constraint on `display_name`; two members can become indistinguishable in the assignee picker (which shows name only).

### AS-203 / AS-205 — Server Action body limit defeats the avatar size story · **blocker**

`next.config.ts` sets no `experimental.serverActions.bodySizeLimit`. Verified in `node_modules/next/dist/server/app-render/action-handler.js:517-518`: `const defaultBodySizeLimit = '1 MB'`, enforced by a size-tracking transform piped in front of busboy — i.e. before the action body is decoded and before `uploadAvatar` runs at all. The app's declared limit is 2 MB, justified in `lib/validation/profile.ts` as covering "a full-resolution phone photo".

Consequences:
- 1–2 MB avatars (the intended case) 413 and never upload → **AS-203 fails**.
- \>2 MB avatars 413 before `uploadAvatarSchema` runs, so the correct, well-sourced message "Avatar must be 2MB or smaller." is never shown → **AS-205 fails**.
- `components/profile/profile-form.tsx:117-133` has no `try`/`catch` around `await uploadAvatar(formData)`. On a 413 the promise rejects: `URL.revokeObjectURL` never runs, the optimistic preview never reverts, no `toast.error` fires, and the rejection escapes `startAvatarTransition` into an error boundary. The `result.ok === false` branch is fine — it just never runs for this failure mode.
- Neither failure is detectable by the current tests, because `tests/integration/upload-avatar.test.ts` imports and calls `uploadAvatar(formData)` in-process with a Node-constructed `FormData`, never crossing the HTTP pipeline that owns the limit. The size test proves "the function rejects", not "the product rejects with that message".

To be clear about what *is* right: the size is measured against real bytes (`file.size` on a `File` materialised from the multipart stream), not a client-declared number, and the message is derived from the same constant as the check. The enforcement is correct; it is unreachable.

Also on this feature:
- **major** — no compensating rollback. If the Storage upsert succeeds and the `profiles` update fails (`lib/actions/profile.ts:115-126`), the previous avatar object is already destroyed while `avatar_url` still points at the same fixed path with the old `?v=` token. `lib/actions/attachments.ts:190` does the corresponding `remove()`; `uploadAvatar` does not. Untested.
- **minor** — the bucket's `file_size_limit` (2097152, hardcoded in SQL) and `MAX_AVATAR_SIZE_BYTES` (computed in TS) can drift with no test pinning them together. If the bucket ever rejects first, the user gets the generic "Something went wrong."

### AS-206 — avatar type check is content-blind · **blocker**

All three nominal enforcement layers inspect the same client-controlled string:
1. `mimeType: file.type` (`lib/actions/profile.ts:55`) — the multipart part's declared `Content-Type`.
2. `contentType: parsed.data.mimeType` (`:85`) — the action forwards that same declared value to Storage.
3. bucket `allowed_mime_types` — validates the value the action just forwarded, which by construction already passed the allowlist. **This layer can never fire on the app path.** It is a no-op, not defense in depth.

Nothing sniffs magic bytes. The feature's own AS-203 test demonstrates the bypass: it constructs `new File([new Uint8Array([1,2,3,4,5,6,7,8])], "avatar.png", { type: "image/png" })` — eight arbitrary bytes, not a PNG by any definition — and the test asserts the public URL serves them back verbatim. A user renaming `evil.exe` to `evil.png` gets `image/png` from the browser and the upload succeeds. The existing AS-206 tests only cover `.sh` and `.svg`, both of which *declare* a disallowed type — i.e. they test the check that works, never the attack.

Stored XSS is not currently reachable (the gateway sends `x-content-type-options: nosniff`, and `text/html` cannot enter via the allowlist), but arbitrary binary content is served from a public, app-branded URL under an `image/png` label.

Adjacent Storage finding — **major**: `avatars_objects_select_public ... to authenticated, anon using (bucket_id = 'avatars')` lets an unauthenticated caller with the publishable key call `POST /storage/v1/object/list/avatars` and enumerate every user's UUID as a folder name. This directly contradicts the migration's own "unguessable object path" rationale, and the public-URL endpoint needs no SELECT policy at all, so the policy buys nothing. Also: the INSERT policy permits any object name under the user's own prefix, so a direct API call can create unlimited 2 MB objects per user, and with no DELETE policy the user cannot clean them up. The path-ownership check itself (`split_part(name,'/',1)::uuid = auth.uid()`, present on both INSERT and UPDATE) is correct — cross-user overwrite is genuinely blocked — but has zero test coverage.

### AS-207 — due-date text is still formatted in ambient time · **blocker**

`components/task/task-card.tsx:64-70` and `components/task/task-list-table.tsx:64-72`:

```ts
function formatDueDate(dueDate: string): string {
  const date = new Date(dueDate);
  if (Number.isNaN(date.getTime())) return dueDate;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
```

No `timeZone` option, so `Intl` uses the ambient runtime zone. Reproduced independently by running the exact function under four zones for `due_date = "2026-08-20"`:

| runtime TZ | rendered |
|---|---|
| UTC | Aug 20, 2026 |
| America/New_York | **Aug 19, 2026** |
| America/Los_Angeles | **Aug 19, 2026** |
| Asia/Tokyo | Aug 20, 2026 |

Both components already receive a `timezone` prop — it is threaded correctly and used for the overdue badge — and simply never reaches the formatter. Effects:
- Every user west of UTC sees the wrong due date on board cards, the project List view, **and** the workspace dashboard table (`task-list-table.tsx` is the shared component behind list + dashboard).
- **A single card contradicts itself.** For a New York user on 2026-08-20, the badge correctly says "not overdue" (due today, NY time) while the text beside it reads "Aug 19" — yesterday. This is exactly the two-screens-disagree failure the assertion exists to prevent, collapsed into one card.
- **Hydration mismatch** on every due-date cell: server (typically UTC) emits "Aug 20", browser (e.g. Los Angeles) emits "Aug 19".

The handoff's "every call site was found" claim was scoped to `grep isOverdue|overdue` — a due-date *formatter* matches neither pattern.

What *is* correct, and is genuinely good work: `lib/time/user-timezone.ts` never throws on an invalid zone, handles DST via independent next-day-midnight resolution (tested against the 2026-03-08 US spring-forward), and the null-timezone fallback is the literal `"UTC"` constant, **not** the server zone (`profiles.timezone` is `not null default 'UTC'`). The RPC (`20260818210500_rpc_overdue_count_timezone.sql`) takes `p_timezone`, uses `AT TIME ZONE`, and drops the old single-arg overload so there is no split-brain. Its overdue definition matches the TS one term for term (strict `<`, `status <> 'done'`, NULL-safe, `due_date` is a plain `DATE` throughout).

Remaining lower-severity timezone findings:
- **major** — no test pins the RPC's overdue count against the client-side `isOverdue` verdict for the same task + timezone. The two definitions match on inspection but nothing prevents them drifting; that is the one test that would have to fail before the dashboard and the board disagreed.
- **major** — `timezone` is optional at every React boundary with a silent `"UTC"` default (`task-card.tsx:78`, `task-list-table.tsx:81`, `task-detail-sheet.tsx:142`, `lib/queries/dashboard.ts:107`) or no default at all (`board.tsx:118`, `board-column.tsx:59`, `sortable-task-card.tsx:34`, `dashboard-task-table.tsx:58`). Every current call site passes it, but any future page that forgets renders every task as if the user were in UTC, with no type error and no runtime warning.
- **major** — `profiles.timezone` has no CHECK constraint. An invalid value makes `AT TIME ZONE` raise 22023; the dashboard then logs and renders **0 overdue** (`w/[workspaceSlug]/page.tsx:106-114`) while the board renders *nothing* overdue. Both fail silently, in the same reassuring direction.
- **minor** — adjacent ambient-time sites outside AS-207's scope but in the same class: `components/task/time-tracking.tsx:96-100` (`todayDateString()` from the browser's offset; the component has no `timezone` prop), `w/[workspaceSlug]/time/page.tsx:41-52` (`defaultRange()` from server-local `new Date()`), and `entry_date` written as `current_date` in the timer RPCs.
- **minor** — `lib/queries/dashboard.ts:93` cites migration `20260818210000_...`, which does not exist (actual: `20260818210500_...`).

### AS-210 — soft-deleted workspace is a permanent profile-visibility grant · **major**

`shares_workspace_with()` (`20260818200946_create_profiles.sql:98-114`) joins `workspace_members` to itself and checks `status = 'active'` on both sides, but never joins `workspaces` and never checks `deleted_at is null`. Every other policy in this schema pairs the membership check with a soft-delete filter — `workspaces_select_active_members`, `projects`, `tasks`, `comments` all do.

`deleteWorkspace` (`lib/actions/workspaces.ts:867-870`) only sets `deleted_at` on the `workspaces` row; it does not touch `workspace_members`, which stay `active` forever. So two users whose only shared workspace has been deleted still satisfy the helper and can read each other's `profiles` row — display name, avatar URL, timezone — indefinitely, from a workspace that no longer exists anywhere in the UI. Unlike member removal (which genuinely `delete`s the row, so revocation works there), this grant can never be revoked by any UI action.

Fix: join `workspaces w on w.id = caller_membership.workspace_id` and add `and w.deleted_at is null`; add a test that soft-deletes the shared workspace and asserts the fellow member's read drops to `[]`.

Related findings on the same migration, none of which break AS-201/208/209:
- **major** — `set search_path = public` is not sufficient hardening for a SECURITY DEFINER function. Postgres searches `pg_temp` first for relation names when `pg_temp` is not explicitly listed, so a session that can `CREATE TEMP TABLE workspace_members(...)` could shadow the unqualified references on lines 106-107 and make the function return `true` for any target. Not reachable through PostgREST today (no DDL surface), so this is latent rather than exploitable — but the migration's comment claiming the reference "cannot be hijacked" overstates it. Correct forms: `set search_path = ''` with `public.`-qualified references, or `set search_path = public, pg_temp`. The same pattern is inherited from `is_active_workspace_member`, `is_workspace_admin`, and `remove_workspace_member`, so a fix should sweep all of them.
- **major** — `profiles.id uuid primary key references auth.users (id)` has no `on delete cascade`. Since every user now has a profile row, **every** user deletion now fails with an FK violation unless the profile is deleted first. The test's own `afterAll` documents working around this.
- **major** — the UPDATE policy permits a user to write *any* column of their own row, and the table has no CHECK constraints. `avatar_url` is therefore attacker-controlled free text via a direct PostgREST `PATCH`, bypassing `uploadAvatarSchema`; `lib/queries/people.ts` feeds it into a plain `<img src>` in `components/user-avatar.tsx:79` with no origin allowlist (`next.config.ts` defines no `images.remotePatterns`). A user can point their avatar at an arbitrary external URL that loads in every co-worker's browser — an IP/User-Agent beacon at minimum. `display_name` likewise has no DB-side length bound while Zod enforces 80.
- **minor** — `grant execute ... to anon` on `shares_workspace_with` is pointless (`auth.uid()` is null for anon) and PostgREST exposes the function as an RPC, letting any authenticated user probe an arbitrary UUID for co-membership.
- **minor** — a trigger failure aborts the sign-up transaction. `handle_new_user()` has no exception handler; `on conflict do nothing` covers only the duplicate-key case, despite the comment implying broader protection. Any future NOT NULL/CHECK on `profiles` turns every sign-up into "Database error saving new user".
- **minor** — the second AS-201 test is mislabelled as a backfill test but only re-checks users created in `beforeAll`, i.e. after the migration ran. Deleting the backfill statement would fail no test.

### AS-214 — no test exercises the assertion · **major**

`tests/unit/user-avatar-call-sites.test.ts` is `readFileSync` plus two regexes per file:

```ts
expect(source).toMatch(/import\s*\{[^}]*\bUserAvatar\b[^}]*\}\s*from\s*["']@\/components\/user-avatar["']/);
expect(source).toMatch(/<UserAvatar\b/);
```

It asserts that a *string* appears in a *file*. It would pass if `UserAvatar` returned `null`, if the component threw at runtime, or if the JSX sat inside `{false && ...}`. It fails only if someone renames an import — false negatives for cosmetic changes, false positives for every real regression. It is a test that mirrors the implementation, and it is the sole evidence offered for AS-214.

By manual inspection the code is in fact correct — `<UserAvatar` is rendered on all four required surfaces (task cards `task-card.tsx:161`, members list `settings/members/page.tsx:156`, comments `comment-list.tsx:243`, assignee pickers `task-detail-sheet.tsx:457,480` / `list-filters.tsx:200,219` / `new-task-dialog.tsx:243,262`), with data genuinely plumbed through `board/page.tsx:86 → board.tsx:327 → board-column.tsx:99 → sortable-task-card.tsx:47`. But there is no executable evidence, and there cannot be: `vitest.config.ts` sets `environment: "node"` and the repo has no jsdom, no happy-dom, and no `@testing-library/*` in `package.json`. Twelve other files under `tests/unit/` use the same source-grep pattern, so this is an established habit rather than a one-off.

**minor** — `components/task/list-filters.tsx:200` passes `name: assigneeLabels[value] ?? value`, so on a label-map miss the avatar renders the first two hex characters of a UUID as initials.

---

## Major findings on PASSing assertions

**AS-213 — no test measures first paint.** Three of the four AS-213 tests are `page.goto(...)` followed by `page.evaluate(...)`, which reads the *post-load* DOM. An implementation that applied the theme in a `useEffect` and flashed white for 500 ms passes all three identically. Test 4 ("light stored does NOT get dark") runs under Playwright's default light `colorScheme`, so an implementation that never sets any class also passes it. Only test 1 — a regex over the raw HTML response asserting a blocking inline script touching `document.documentElement` — has anti-flash power, and it never checks the script's **position**: moving `<ThemeProvider>` below the page content reinstates the flash while all four tests stay green. Position is precisely the property that makes the mechanism work. (Also: `expect(fullScriptTag).not.toMatch(/\basync\b/)` is applied to the whole match including the script *body*, not the opening tag — false-fragile rather than false-passing.)

**AS-213 — pre-hydration control state.** `components/theme-toggle.tsx:58-62` uses `useSyncExternalStore` rather than a `mounted` guard — the correct pattern, and it produces no hydration mismatch and no layout shift (all three buttons are in the SSR HTML). But the server renders `value={[]}`, so **the first paint shows all three segments unpressed**; the active one lights up only after hydration. No test asserts `aria-pressed` on the pre-hydration markup.

**AS-211 — reachability.** `ThemeToggle` is imported in exactly one place (`components/nav/app-sidebar.tsx:24`, rendered at `:99`) and `AppSidebar` in exactly one place (`w/[workspaceSlug]/layout.tsx:131`). The toggle is therefore unreachable on `/`, `/sign-in`, `/onboarding`, and `/dev-login` — all of which render themed content. A visitor who has never signed in cannot switch themes. On mobile it is two interactions deep behind the hamburger sheet. Marked PASS because the assertion says "the app has a visible theme toggle", not "on every route", but this is a real product gap the commit does not acknowledge.

**AS-212 — unvalidated stored value.** `storageKey` is left at next-themes' default `"theme"` — a maximally generic key on `http://localhost:<port>` in dev. A stale or foreign value (say `"purple"`) leaves no segment pressed and makes the injected script do `classList.add("purple")` on `<html>`. No sanitisation anywhere.

**AS-208 — the WITH CHECK path is untested, and production writes bypass RLS entirely.** No test attempts `update({ id: otherUserId }).eq("id", myUserId)`; removing `with check (id = auth.uid())` would leave the whole suite green. Separately, both write paths in `lib/actions/profile.ts` use `createAdminClient()` (RLS-bypassing), so AS-208 holds there only because both hardcode `.eq("id", user.id)` from a server-verified session. Any future refactor that accepts a target id defeats AS-208 with zero test coverage.

**AS-204 — the hash's multiply is dead weight.** `hash = (hash * 33) ^ c` with a palette length of 8: because `hash * 33 = hash * 32 + hash` and `hash * 32` has its low 5 bits zero, the low bits never mix. Empirically the index is exactly `(XOR of all charCode & 7)` over 20 000 random strings, and the degeneracy holds for every power-of-two palette length up to 32. Consequences: anagram-invariant (`"alice"` and `"ecila"` collide), characters 8 apart collide. Distribution over real v4 UUIDs is nonetheless flat (12.4–12.7 % per bucket over 100 000 samples), so AS-204 holds today — but the file's own header plans to reuse this for swimlane/grouping colours keyed on short strings like `"todo"`, where it will collide badly. The `>>> 0` guarding the negative-modulo crash is present and correct.

**AS-204 — the determinism test does the opposite of what it claims.** `tests/unit/user-color.test.ts` contains a test titled "a fixed, known user id resolves to a stable index — locks in the hash so a future refactor can't silently reshuffle everyone's colour" whose body explicitly declines to assert a specific index. A golden-value assertion is precisely what that title describes, and it is the only thing that would catch a cross-engine hash change. The remaining determinism tests call the function twice in one process and assert equality — true of any pure function, including `() => 0`. Credit where due: the contrast test is real and numeric (`it.each` over all 8 pairs asserting `>= 4.5`), and my independent recomputation agrees to 2 dp on all eight. But it asserts the threshold, not the documented numbers, and it inspects palette constants — never a rendered node. The entire contrast story hangs on one untested line (`style={{ color: color.foreground }}` in `user-avatar.tsx`); if that were dropped, `text-muted-foreground` takes over and every pair collapses to 1.00–2.42 : 1 while all 23 tests still pass.

**AS-204 — initials split surrogate pairs.** `initialsFor` uses `.charAt(0)` / `.slice(0,2)`, which are UTF-16 code-unit operations. `"A🙂"` → `"A\uD83D"` → renders `A�`; `"🙂 Smith"` → `�S`. `display_name` is free-text user input. Empty/null/whitespace/Cyrillic/CJK/single-word all handled correctly — this is only the astral-character case. `Array.from(label)` fixes it.

---

## Cross-cutting finding: none of this is enforced in CI · **blocker for the milestone's evidence, not for any single assertion**

`.github/workflows/ci.yml` has **no `env:` block and references no `secrets.*`** (48 lines, verified). Consequences:

- `npm run test` runs `vitest run`, which includes `tests/integration/**` (`vitest.config.ts` excludes only `node_modules` and `tests/e2e`). With no `.env` in CI, `haveCoreCreds`/`haveAdminCreds` are false and `describe.skipIf(...)` silently skips **every** integration test in this milestone — `rls-profiles`, `upload-avatar`, `update-profile`, `overdue-count-rpc` — contributing zero executed assertions while CI reports green.
- `package.json`'s `test` script adds a second silent-pass layer: it short-circuits to `echo ... exit 0` unless `tests/unit` is non-empty.
- The Playwright step's guard now clears (both `@playwright/test` and `tests/e2e` exist), so it will attempt to run — but `proxy.ts` matches every path and calls `createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, ...)`, which throws with no env. Every request 500s, the `webServer` health check never succeeds, and the step times out at 120 s. Even if it booted, `test.skip(!haveAdminCreds, ...)` at `theme-toggle.spec.ts:163` skips the AS-211/AS-212 block.

So AS-201, AS-203, AS-205, AS-206, AS-208, AS-209, AS-210, AS-211, and AS-212 are all protected only by a developer remembering to run the suite locally against the live project. This is pre-existing (not introduced by M10) but it is the reason several of the failures above shipped marked COMPLETE.

**Test-suite stability, separately:** at vitest's default 5 s timeout the full suite is red and non-deterministically so — two consecutive runs gave 41 failures / 21 files and 36 failures / 12 files, all timeouts against the remote Supabase project, spanning mission-1 features (F018, F020, F021, F046, F065) as well as M10. At `--testTimeout=30000` the suite is fully green (575/575, 104/104). No M10 regression is involved, but "run the tests" currently gives a different answer each time.

---

## Recommended follow-up features

**FU-1 · Link the profile settings page into the app shell (AS-202, blocker).**
Add a user/account entry point to `components/nav/app-sidebar.tsx` — a footer menu carrying the signed-in person's `UserAvatar`, their resolved display name, a Profile link to `/w/<slug>/settings/profile`, and the existing Sign out — or a Settings nav group containing Profile and Members. The route, its `loading.tsx`, and the form already work; this is purely the missing entry point. Add a Playwright test that signs in, clicks from the workspace root to the profile page without a hardcoded URL, sets a display name, and asserts the name appears on a task card or in the members list — closing both the reachability gap and the "shown everywhere is never render-tested" gap in one test. While there, drop the now-redundant email subtitle in `settings/members/page.tsx:166-168` and `time/page.tsx:207-209`, and decide whether the members list should keep showing the email once a display name is set.

**FU-2 · Make the avatar size limit reachable and the type check content-based (AS-203, AS-205, AS-206, blocker).**
Set `experimental.serverActions.bodySizeLimit` in `next.config.ts` to comfortably above `MAX_AVATAR_SIZE_BYTES` (multipart overhead means a 2 MB file's request body exceeds 2 MB — `'3mb'`), so oversize files reach `uploadAvatarSchema` and get the message that names the limit. Wrap the `uploadAvatar` call in `components/profile/profile-form.tsx` in try/catch with the object-URL revoke and preview revert in a `finally`, and add a client-side pre-flight size check using the same constant so 413s are avoided entirely. In `lib/actions/profile.ts`, sniff the leading bytes of `await file.arrayBuffer()` against the JPEG/PNG/WebP signatures and reject on mismatch with the declared type, before the Storage call; and on `updateError`, `remove([objectPath])` to match `uploadAttachment`'s existing cleanup. Tests: a spoofed-MIME case (non-image bytes declared `image/png`) that must be rejected, a bucket-config-equals-TS-constants assertion, and an HTTP-level oversize test that actually crosses the action pipeline.

**FU-3 · Format due dates in the user's timezone and pin the two overdue definitions together (AS-207, blocker).**
Pass the `timezone` prop already threaded into `components/task/task-card.tsx` and `components/task/task-list-table.tsx` into their `formatDueDate` implementations as `Intl`'s `timeZone` option (or replace both with one shared helper in `lib/time/user-timezone.ts` so a third copy cannot appear). Make the `timezone` prop required across the board/list/dashboard component chain instead of defaulting to `"UTC"`, so a future page that forgets it is a type error rather than a silent UTC render. Add a CHECK constraint or a validated-set gate on `profiles.timezone` and tighten `isValidTimeZone` to `Intl.supportedValuesOf("timeZone")` plus the explicit `"UTC"` alias. Tests: assert the rendered due-date string for a west-of-UTC zone; and add the missing cross-layer agreement test that seeds tasks and asserts `get_overdue_count(ws, tz)` equals the count of `isOverdueInTimeZone(task, tz)` over the same rows, for a zone each side of UTC.

**FU-4 · Close the profiles RLS gaps (AS-210, major; plus AS-208 hardening).**
Add `join workspaces w on w.id = caller_membership.workspace_id ... and w.deleted_at is null` to `shares_workspace_with()`. Sweep all four SECURITY DEFINER helpers (`shares_workspace_with`, `is_active_workspace_member`, `is_workspace_admin`, `remove_workspace_member`) to `set search_path = ''` with `public.`-qualified references. Add `on delete cascade` to `profiles.id`'s FK. Add an exception handler to `handle_new_user()` so a future constraint cannot break sign-up. Constrain what a user may write to their own row: a CHECK bounding `display_name` length and restricting `avatar_url` to the project's own avatars-bucket prefix (or narrow the UPDATE grant to `timezone` and route name/avatar writes exclusively through the Server Actions). Drop the pointless `anon` grant on `shares_workspace_with` and the `avatars_objects_select_public` policy that enables anonymous user-id enumeration. Tests: soft-delete the shared workspace and assert the read drops to `[]`; remove the member and assert the same; attempt `update({ id: otherUserId }).eq("id", myUserId)` and assert it is rejected; attempt a cross-user Storage write with two real user JWTs.

**FU-5 · Give the repo a DOM test environment and replace the source-grep tests (AS-214, major).**
Add jsdom (or happy-dom) plus `@testing-library/react` to `vitest.config.ts` and rewrite `tests/unit/user-avatar-call-sites.test.ts` — and the eleven sibling files using the same `readFileSync` pattern — as actual render assertions: render a task card, a members row, a comment, and an assignee picker option, and assert an avatar node with the expected initials, background colour, and accessible name. Add the render-level contrast test that reads the computed foreground off a rendered `AvatarFallback`, so dropping `color: color.foreground` fails a test instead of silently collapsing every pair to 1.0:1. While there: fix `initialsFor` to use `Array.from(label)` so emoji display names don't render `�`, add a golden `id → index` assertion to `tests/unit/user-color.test.ts` (the test that names itself as doing this currently refuses to), and either replace the `* 33` hash with one that actually mixes low bits or document that the module must not be reused for short keys.

**FU-6 · Make CI actually run the suite, and make the theme tests measure first paint (cross-cutting).**
Add the Supabase URL / publishable key / secret key to the CI workflow's `env:` from repository secrets so the integration and e2e suites execute instead of skipping; replace `describe.skipIf(...)` with a hard failure when the credentials are absent in CI (keeping the local skip), and drop `package.json`'s `echo ... exit 0` placeholder. Raise vitest's `testTimeout` to ~30 s in `vitest.config.ts` — at the default 5 s the suite is non-deterministically red against the remote project. For AS-213, replace the post-load DOM reads with a real first-paint measurement (a CDP screencast frame, or `page.addInitScript` capturing `document.documentElement.className` at the earliest observable moment) and extend the raw-HTML assertion to pin the theme script's **position** ahead of page content, since that is the property the whole mechanism depends on. Optionally mount `ThemeToggle` on the public/auth routes so AS-211 holds for signed-out visitors.

---

## Appendix: verification output

### `npx tsc --noEmit`

```
(exit 0 — no output)
```

### `npx eslint .`

```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  159:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

✖ 1 problem (0 errors, 1 warning)
(exit 0)
```

### `npm run test` — default 5 s timeout (two consecutive runs)

```
Run 1:  Test Files  21 failed | 83 passed (104)
             Tests  41 failed | 520 passed | 14 skipped (575)
          Duration  148.00s

Run 2:  Test Files  12 failed | 92 passed (104)
             Tests  36 failed | 539 passed (575)
          Duration  120.48s
```

All failures are `Error: Test timed out in 5000ms.` against the remote Supabase project, spanning mission-1 features (`revoke-invite`, `reorder-task`, `upload-attachment`, `start-stop-timer`, `timer-rpc-membership-hardening`) as well as M10 (`update-profile`). Non-deterministic set between runs. No assertion failures.

### `npx vitest run --testTimeout=30000` (full suite)

```
Test Files  104 passed (104)
     Tests  575 passed (575)
(exit 0)
```

### `npx vitest run <M10 files only> --testTimeout=30000`

```
Test Files  10 passed (10)
     Tests  79 passed (79)
(exit 0)
```
Files: `tests/integration/rls-profiles.test.ts`, `upload-avatar.test.ts`, `update-profile.test.ts`, `overdue-count-rpc.test.ts`; `tests/unit/user-color.test.ts`, `user-timezone.test.ts`, `is-overdue.test.ts`, `update-profile-schema.test.ts`, `people-name-resolution.test.ts`, `user-avatar-call-sites.test.ts`.

### `npx playwright test tests/e2e/theme-toggle.spec.ts`

```
Running 6 tests using 1 worker

  ✓  1 [chromium] › AS-213 › the raw HTML response embeds a synchronous, blocking theme script before any content (331ms)
  ✓  2 [chromium] › AS-213 › a returning visitor with dark stored sees <html class="dark"> with no light-first frame (271ms)
  ✓  3 [chromium] › AS-213 › a fresh visitor with dark OS preference and no stored choice still gets dark first paint (system default) (267ms)
  ✓  4 [chromium] › AS-213 › a returning visitor with light stored does NOT get the dark class (sanity check against a script that always sets dark) (265ms)
  ✓  5 [chromium] › AS-211 › a visible toggle offers light, dark, and system, and is keyboard-operable with an accessible name (2.2s)
  ✓  6 [chromium] › AS-212 › the selected theme persists across a reload and a new tab (2.8s)

  6 passed (9.4s)
```
Run locally with `.env` present; no stray `next dev` was running. These tests pass but, as detailed under AS-213 above, tests 2–4 read the post-load DOM rather than first paint.

### Independent reproduction — AS-207 due-date drift

Running the exact `formatDueDate` body from `components/task/task-list-table.tsx:64` under four process timezones, input `due_date = "2026-08-20"`:

```
--- UTC                  ->  Aug 20, 2026
--- America/New_York     ->  Aug 19, 2026
--- America/Los_Angeles  ->  Aug 19, 2026
--- Asia/Tokyo           ->  Aug 20, 2026
```

### Independent reproduction — AS-204 contrast ratios

WCAG 2.x relative luminance recomputed from scratch (sRGB → 0.03928/12.92 and ((c+0.055)/1.055)^2.4 branches → L = 0.2126R + 0.7152G + 0.0722B → (L1+0.05)/(L2+0.05)), against the foreground each pair actually renders via inline style:

| name | bg | fg | claimed | recomputed | AA 4.5:1 |
|---|---|---|---|---|---|
| red | `#dc2626` | `#ffffff` | 4.83 | 4.83 | PASS |
| orange | `#ea580c` | `#0f172a` | 5.02 | 5.02 | PASS |
| amber | `#b45309` | `#ffffff` | 5.02 | 5.02 | PASS |
| green | `#16a34a` | `#0f172a` | 5.42 | 5.42 | PASS |
| teal | `#0d9488` | `#0f172a` | 4.77 | 4.77 | PASS |
| blue | `#2563eb` | `#ffffff` | 5.17 | 5.17 | PASS |
| indigo | `#4f46e5` | `#ffffff` | 6.29 | 6.29 | PASS |
| fuchsia | `#c026d3` | `#ffffff` | 4.71 | 4.71 | PASS |

All eight claimed ratios are exactly correct. Rendered size is 14px (`text-sm`) / 12px (`size="sm"`), both normal text, so 4.5:1 is the correct threshold — the palette's rejection of the 3:1 large-text threshold is right. The palette is fixed hex applied inline, so contrast is theme-invariant.

### Independent verification — Next.js Server Action body limit

`node_modules/next/dist/server/app-render/action-handler.js:517-518`:
```js
const defaultBodySizeLimit = '1 MB';
const bodySizeLimit = (serverActions == null ? void 0 : serverActions.bodySizeLimit) ?? defaultBodySizeLimit;
```
`next.config.ts` sets no `experimental.serverActions` block. Enforced at lines 546/638/669 by a size-tracking transform ahead of busboy, throwing `ApiError(413, 'Body exceeded 1 MB limit.')` before the action body is decoded.
