# M17 — UX polish, attachments & navigation: scrutiny report (PASS 1)

Scope: F258–F267 (attachments drag-drop/progress/thumbnails/paste, sidebar project list +
favourites, mobile board/task-detail/layout audit, header search). Assertions AS-501–AS-522.
Migration `20260831010000_project_favorites.sql`.

Per the user's standing cap (`NEXT-SESSION.md` § "Hard-won lessons": M15 capped at six
passes, M16 at two, blockers-only past pass 1), this is **PASS 1** and the recommended
follow-ups below are prioritised blockers-first. Majors/minors are recorded for the record.

Method: four parallel reviewers reading code/SQL/tests only (no handoffs passed in), plus
this validator's own verification of every load-bearing claim directly against source, the
`ca0dc61` diff, and the F266 commit history. Live DB probing was **not** performed this
pass (M16's probe budget was the exception, not the rule); the attachment and favourites
integration suites were run against the real linked Supabase project instead.

Toolchain (this validator, from a clean tree):
- `npx tsc --noEmit` — **exit 0, no output.**
- `npx eslint .` — **0 errors**, 6 pre-existing unused-var warnings (unchanged set).
- `npx vitest run --dir tests/unit` — **162 files / 1242 tests, all passed.** One
  pre-existing unhandled rejection artefact in `tests/unit/user-avatar.test.tsx`
  (`cookies()` outside request scope via `getMentionCandidates`); note M16's known-failing
  `tests/unit/trash-list.test.tsx` is now green.
- `npx vitest run tests/integration/{rls-project-favorites,upload-attachment,rls-attachments}.test.ts`
  — 3 files / 23 tests passed (live Supabase).

## Verdict: **NOT GREEN — 3 blockers.**

The favourites RLS design, the guest scoping, the single-upload-funnel property, and the
`ca0dc61` flexbox fix all hold up under adversarial reading — the areas the assignment was
most worried about are the areas that are actually sound. The blockers are elsewhere: an
over-exported Server Action that trusts a caller-supplied `userId`, an assertion that says
"instead of" where the code renders both, and a 32px control sitting in the mobile nav bar
next to the one that was bumped to 44px. Two of the three are one-line fixes.

---

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-501 | PASS | Native HTML5 dropzone → `attachmentListRef.uploadFiles` → the shared `uploadAttachment` action (`components/task/task-detail-sheet.tsx:1051-1057`). Wiring seam itself untested — MIN-1. |
| AS-502 | PASS | Highlight overlay + "Drop files to attach" label mount on `dragenter` (`components/task/attachment-dropzone.tsx:139-143`). Test proves mount, not visibility — MIN-2. |
| AS-503 | PASS | `lib/tasks/upload-files-with-concurrency.ts`; `tests/unit/upload-files-with-concurrency.test.ts:31` measures real peak in-flight count. |
| AS-504 | **FAIL (major)** | Per-file *status* (spinner), not progress: `components/task/upload-progress.tsx:81-86`, and `tests/unit/upload-progress.test.tsx:41-59` asserts the *absence* of "%". Rationale is technically sound (Server Actions expose no upload-progress event) but the assertion's literal wording is not met — MAJ-1. |
| AS-505 | **FAIL (blocker)** | The generic `FileText` icon renders **unconditionally**, including on image rows that already show a thumbnail (`components/task/attachment-list.tsx:499-502`, thumbnail at `:491-497`). The assertion says "thumbnail preview **instead of** a generic file icon"; the UI shows both — BLOCKER-2. |
| AS-506 | INCONCLUSIVE (major) | Escape-closes-lightbox is proven in isolation (`tests/unit/image-lightbox.test.tsx`); Escape-doesn't-also-collapse-the-sheet is never exercised — MAJ-2. |
| AS-507 | PASS | Client rejection issues no network call (`attachment-list.tsx:375-385`); server rejects before any Storage/DB write (`lib/actions/attachments.ts:136-141`); insert failure removes the object (`:270`). Live-proven by row-absence checks in `tests/integration/upload-attachment.test.ts:331,367`. Cancel-path caveat MAJ-3. |
| AS-508 | PASS | `components/comment-list.tsx:616-618` builds its own FormData but calls the **same** action; `tests/unit/clipboard-image-paste.test.tsx:246-289` drives a real Tiptap paste event and asserts the draft survives failure with no `<img>` inserted. Genuinely behavioural. |
| AS-509 | PASS | Real project rows (`components/nav/project-nav-list.tsx:131-180`) fed from `getWorkspaceProjects` at `app/(workspace)/w/[workspaceSlug]/layout.tsx:228-236`. Test asserts visible names/keys. |
| AS-510 | PASS | Pinned group (`project-nav-list.tsx:124-129, 224-238`); `tests/unit/project-favorites-sidebar-pin.test.tsx:41-100` asserts real DOM ordering against both prop order and alphabetical order. |
| AS-511 | PASS | `aria-current="page"` + accent classes (`project-nav-list.tsx:133-148`); test asserts present-on-active / absent-on-other. |
| AS-512 | **FAIL (major)** | Behaviour is probably fine, but the only test asserts that `className` contains the strings `"overflow-y-auto"` and `"max-h-"` (`tests/unit/app-sidebar-project-nav-list.test.tsx:98-114`) — pure implementation mirroring. Plus a real gap: the primary nav at `components/nav/app-sidebar.tsx:178-181` has no `shrink-0` — MAJ-4. |
| AS-513 | PASS | Empty state + `NewProjectDialog` (`project-nav-list.tsx:212-218`); tested behaviourally. |
| AS-514 | PASS | `ca0dc61` verified correct (see below). Test is class-string mirroring — MAJ-5. |
| AS-515 | PASS (functionally) | "Move to" dropdown works without a pointer (`components/board/sortable-task-card.tsx:147-183`; `tests/unit/f264-mobile-board.test.tsx:104-129` renders with no `DndContext` and asserts the callback). But the affordance is not permission-gated — MAJ-6. |
| AS-516 | PASS | Full-screen classes land on the real portalled sheet element (`components/task/task-detail-sheet.tsx:1017`, `components/ui/sheet.tsx`). Verification is class-string based — MIN-3. |
| AS-517 | **INCONCLUSIVE (blocker: unverifiable)** | **F266 shipped zero code and zero tests.** `git log --grep F266` returns exactly one commit, `600eb6e`, docs-only (`plan.md` + `run-log.md`, 3 insertions); no handoff file exists; `grep -rl "AS-517\|F266" tests/` returns nothing — BLOCKER-3. |
| AS-518 | **FAIL (blocker)** | `NotificationBell`'s trigger is `size="icon"` = `size-8` = **32px** (`components/notifications/notification-bell.tsx:118-119`) and it renders inside the `md:hidden` mobile bar (`components/nav/app-sidebar.tsx:377-383`) directly beside the hamburger that *was* bumped to `max-md:size-11` — BLOCKER-1 (plus three more under-sized drawer controls). |
| AS-519 | PASS (untested wiring) | `AppHeader` is genuinely mounted at `app/(workspace)/w/[workspaceSlug]/layout.tsx:379-382`, but the only test renders `HeaderSearch` in isolation — MAJ-7. |
| AS-520 | PASS | Same `searchPalette` action as the palette, no forked query; 200ms debounce with a monotonic `requestId` guard checked in both `.then` and `.catch` (`components/nav/header-search.tsx:55,152-155,167,175,181`). No stale-response race. |
| AS-521 | PASS (with accepted caveat) | Navigation works; dropdown is mouse-only for selection — MAJ-8. Task rows navigate to the bare board without `?taskId=` — **pre-existing accepted pattern**, identical to F242/F243's palette under AS-461; not re-flagged. |
| AS-522 | PASS | `encodeURIComponent(trimmedQuery)` → `/w/{slug}/search?q=` (`header-search.tsx:201`), matching the search page's own contract. Corpus-width nit at MIN-4. |

---

## BLOCKERS

### BLOCKER-1 — a 32px tap target in the mobile navigation bar (AS-518)

`components/notifications/notification-bell.tsx:118-119` renders its trigger as
`<Button variant="ghost" size="icon" className="relative">`. `components/ui/button.tsx:28`
defines `icon: size-8` → **32px**, and no mobile bump is applied. That control is rendered
inside the mobile-only top bar at `components/nav/app-sidebar.tsx:377-383`, immediately
beside the hamburger which *was* correctly bumped (`app-sidebar.tsx:356` `max-md:size-11`).

So the milestone's own audit bumped four controls to 44px and missed the fifth sitting in
the same 48px bar. Three further nav controls in the mobile drawer are also under-size:
project rows (`components/nav/project-nav-list.tsx:143-148`, `px-2.5 py-1.5 text-sm`, no
`min-h`), the "Projects" collapsible trigger (`:196-199`), and the favourite star
(`:168-177`, `size="icon"`).

**Why no test caught it:** `tests/unit/f265-mobile-task-detail.test.tsx:247-305` renders the
real `AppSidebar` — the bell is *in that very tree* — but asserts only on the hamburger,
the Dashboard link and the profile link. It also passes `projects` undefined, so
`ProjectNavList` renders its empty state and its under-sized rows never exist during the
test. The tests are `className`-regex assertions, so they cannot express "≥44px" at all.

**Fix:** `max-md:size-11` on the bell trigger; `max-md:min-h-11` on `project-nav-list.tsx:144`
and `:198` and the star. Then extend the AS-518 test to render `AppSidebar` **with** a
non-empty `projects` array and assert on every interactive descendant of the `md:hidden` bar
and the drawer, not a hand-picked three.

### BLOCKER-2 — image attachments show a thumbnail **and** a generic file icon (AS-505)

`components/task/attachment-list.tsx:491-497` conditionally renders `<AttachmentThumbnail>`
for `attachment.mimeType?.startsWith("image/")`, and then `:499-502` renders

```tsx
<FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
```

**unconditionally**, on the same row. AS-505 reads "shows a thumbnail preview **instead of**
a generic file icon". The shipped UI shows both.

**Why no test caught it:** `tests/unit/image-lightbox.test.tsx:93-103` asserts only that an
`<img>` with the right alt text exists. It never asserts the generic icon is *absent*, so it
passes with the defect present — a textbook case of a test that confirms the implementation
rather than the assertion's intent.

**Fix:** guard the `FileText` render on `!attachment.mimeType?.startsWith("image/")`, and add
the negative assertion (`queryByTestId`/icon absent on image rows, present on non-image rows).

### BLOCKER-3 — `uploadAttachmentForUser` is a publicly-invocable Server Action that trusts a caller-supplied `userId` (security; pre-existing, reachable, and now fanned into by three new entry points)

`lib/actions/attachments.ts:1` is `"use server"`. Every exported async function in such a
module is registered as a client-invocable Server Action endpoint. `uploadAttachmentForUser`
is **exported** at `:118` with this signature:

```ts
export async function uploadAttachmentForUser(
  userId: string,
  input: { taskId; fileName; fileSize; mimeType; arrayBuffer },
  options?: { objectPathOverride?: string },
)
```

Every one of those is trusted:

- `userId` is taken as already-verified identity (see the doc comment at `:105-108`) — the
  function performs its membership/`canWrite`/visibility checks *against the passed userId*,
  not against the session. A caller reaching this action ID can act as any member.
- `options.objectPathOverride` (`:222-230`) replaces the `${taskId}/…` path convention
  entirely, and the write goes through `createAdminClient()` (`:143`), which **bypasses
  Storage RLS** — so the storage policy is not a backstop. The doc comment calls this
  "test-only" (`:110-117`); a comment is not an enforcement boundary.
- `fileSize` (`:123`) is validated by Zod independently of the real `arrayBuffer` length,
  so the 10MB cap can be declared away.

This is **not introduced by M17** — it predates it (the extension attachments route at
`app/api/extension/attachments/route.ts:138` is the legitimate second caller) — but M17
routes three new entry points (drop, paste, multi-file) into this module, and it is live.

**Fix:** move the shared implementation into a non-`"use server"` module (e.g.
`lib/attachments/upload.ts`) and re-export from `lib/actions/attachments.ts` only the
FormData-taking `uploadAttachment`. The route handler imports the plain function directly.
Replace `objectPathOverride` with a test-only seam that is not a parameter of the exported
surface. The reviewer reports the same shape exists for `createTaskForUser` — worth a
repo-wide sweep of exported `*ForUser` functions in `"use server"` modules.

### BLOCKER-4 (process) — AS-517 is marked COMPLETE on prose alone

`git log --oneline --grep F266` → one commit, `600eb6e`, touching only `missions/…/plan.md`
and `run-log.md`. No `feat(F266)` commit, no `F266-handoff.md`, no test referencing AS-517 or
F266. The run-log describes a concrete method (14 routes at 375×812,
`document.documentElement.scrollWidth === window.innerWidth`) but nothing is reproducible or
attached, and there is **zero regression guard**.

My own static sweep *corroborates* the claim — `layout.tsx:378` carries `min-w-0` on `<main>`;
`components/ui/table.tsx:9-12` wraps every table in `overflow-x-auto`; the sole `min-w-max`
(`timeline/page.tsx:224`) is inside its own `overflow-x-auto` (`:223`); the calendar swaps to
a list below `md` (`components/calendar/month-grid.tsx:106,118,125`). And F267, which shipped
*after* the sweep, is clean (`components/nav/header-search.tsx:205` `w-full max-w-sm`,
truncating results). So the state is very likely correct — but "COMPLETE" here means "a worker
said so", which is exactly the evidence standard this scrutiny cycle exists to reject.

**Fix:** a Playwright spec at 375px asserting `scrollWidth === innerWidth` across the primary
routes, or downgrade AS-517 to explicitly-unverified in the contract's status tracking.

---

## Majors

- **MAJ-1 — AS-504 is met by redefinition.** `components/task/upload-progress.tsx:81-86` is a
  spinner; there is no percentage anywhere, and `tests/unit/upload-progress.test.tsx:41-59`
  asserts "%" is *absent*. The stated rationale (`upload-progress.tsx:5-26`) is correct —
  Server Actions surface no upload-progress event — but a reader of "upload progress is shown
  per file" gets per-file *status*. Contract owner's call: accept the narrowed reading, or
  route uploads through an XHR/`fetch` upload-progress path.
- **MAJ-2 — AS-506 untested in its real container.** The lightbox is only ever rendered
  standalone in tests (`tests/unit/image-lightbox.test.tsx:77-90`), never inside the task
  detail Sheet. In production it lives inside a base-ui Dialog (`components/ui/sheet.tsx`)
  whose Escape handling is independent of the app's escape-layer stack; no
  `onEscapeKeyDown`/`dismissible` prop suppresses it. Whether one Escape closes only the
  lightbox or also collapses the whole sheet depends on listener ordering. Add a test that
  mounts the lightbox inside the real Sheet and asserts the sheet survives one Escape.
- **MAJ-3 — cancelling an upload leaves a real, invisible attachment.** `upload-progress.tsx:119`
  → `attachment-list.tsx:405-408` cannot abort an in-flight Server Action; `uploadOneFile`
  discards the settled result (`attachment-list.tsx:300-303`), so a fully-created row plus
  storage object exists server-side but is absent from the local list until remount. Same at
  `comment-list.tsx:617-620`. Not a *partial* row so AS-507 survives literally, but the UI
  lies. Either `AbortSignal` the request or reconcile the row when a cancelled upload settles.
- **MAJ-4 — sidebar scroll containment is bounded by `max-h-64`, and the primary nav can
  shrink (AS-512).** Real flex containment exists (`app-sidebar.tsx:227`,
  `project-nav-list.tsx:192,211`), but the actual bound is a fixed `max-h-64` at
  `project-nav-list.tsx:222`. Meanwhile `app-sidebar.tsx:178-181` is `flex flex-col …
  overflow-y-auto` with **no `shrink-0`**: on short viewports (~13 nav items ≈ 470px + 256px +
  footer) the primary nav becomes its own scroller and items go out of view — the exact thing
  AS-512 forbids. jsdom does no layout, so no test in the repo could catch it.
- **MAJ-5 — the AS-514 test could never have caught the bug it now guards.**
  `tests/unit/f264-mobile-board.test.tsx:60-88` `readFileSync`s the component and regexes for
  class strings; it does not render. `max-sm:w-[88vw]` was present in source and matched that
  regex for the entire time it was inert. The added regression test (`:72-84`) mirrors the
  fix's class string, guarding deletion of `flex-none` but no new flexbox interference.
- **MAJ-6 — the mobile "Move to" affordance is not permission-gated (AS-515 / AS-231
  regression).** `components/board/sortable-task-card.tsx:115-116` computes `showMoveMenu`
  from prop presence only, and `components/board/board.tsx:981-982` (and `:1047-1048` for
  swimlanes) pass `moveToColumnOptions`/`onMoveToColumn` **unconditionally** — the only two
  write affordances on that element not routed through `canDrag` (`:1002`, `:1004`,
  `:1038`, `:1043`). A viewer sees the menu, taps it, `handleMoveToColumn` optimistically
  mutates (`board.tsx:379`), and the server correctly refuses
  (`lib/actions/tasks.ts:3164-3169`), so it snaps back with an error toast (`:387-390`). **No
  data-integrity hole — hence major, not blocker** — but it is precisely the "control that
  will fail" pattern this same worker's own comment at `sortable-task-card.tsx:69-76` argues
  is forbidden. Fix: gate the two prop pairs on `canDrag`; add a `canDrag={false}` test
  asserting the trigger is absent.
- **MAJ-7 — AS-519 has no test at the layout seam.** `tests/unit/header-search.test.tsx:42`
  renders `HeaderSearch` in isolation; nothing in the suite references `AppHeader` or the
  layout. The wiring is real (`layout.tsx:379-382`), but deleting it leaves the suite green.
- **MAJ-8 — the header search dropdown cannot be operated from the keyboard (AS-521).**
  `components/nav/header-search.tsx:197-202` handles only `Enter`; there is no active-index
  state, no Arrow/Home/End handling, no `aria-activedescendant`, and no ids on options.
  Options are selected exclusively via `onMouseDown` with `preventDefault()` (`:307-317`) —
  which also means they never take focus on click. `aria-selected` is hardcoded `false` at
  `:310` beneath `role="listbox"` (`:230`) and `role="combobox"`/`aria-expanded` (`:213-215`),
  so the component advertises an active-descendant contract it never implements. Buttons
  remain tab-reachable (accidentally, with no blur-close guard), so this is degraded rather
  than impossible for sighted keyboard users; for screen-reader users following the combobox
  contract it is broken.

## Minors

- **MIN-1 — AS-501's wiring seam is untested.** Two half-tests exist
  (`attachment-dropzone.test.tsx:39` proves `onFilesDropped` fires;
  `attachment-list-multi-upload.test.tsx:45` proves `uploadFiles` calls the action) but nothing
  covers `task-detail-sheet.tsx:1051-1057`, the only place they meet. Null the ref and
  everything stays green.
- **MIN-2 — AS-502's test proves mounting, not visibility.**
  `attachment-dropzone.test.tsx:104-122` asserts only that
  `data-testid="attachment-dropzone-highlight"` mounts/unmounts; strip every visual class from
  `attachment-dropzone.tsx:139` and it passes. It never queries the "Drop files to attach"
  label that is actually there (`:141-143`).
- **MIN-3 — AS-516's evidence is class strings.** `tests/unit/f265-mobile-task-detail.test.tsx`
  header comment (`:14-21`) honestly admits jsdom cannot verify the CSS computes to full-screen
  at 375px. The collapse test (`:216-243`, `aria-expanded` flips) is the one strong assertion
  in the file.
- **MIN-4 — Enter's destination is narrower than the dropdown.** `header-search.tsx:201` routes
  to `/w/{slug}/search?q=`, which calls only `searchWorkspaceTasks`
  (`app/(workspace)/w/[workspaceSlug]/search/page.tsx:82`, copy at `:94`), while the dropdown
  shows Projects *and* Tasks (`header-search.tsx:246,270`). AS-522's literal wording ("same
  query") is met; the result-set semantics are not.
- **MIN-5 — header is not sticky.** `components/nav/app-header.tsx:32` has no `sticky top-0`
  and sits inside the `overflow-y-auto` `<main>` (`layout.tsx:378`), so it scrolls out of view —
  contradicting its own "always-visible"/"always-present" comments (`app-header.tsx:1-2`,
  `header-search.tsx:3-4`).
- **MIN-6 — a failed header search is indistinguishable from an empty one.**
  `header-search.tsx:179-184` catches, `console.error`s, and sets `EMPTY_RESULTS`; `:240-244`
  then renders the same "No results found." Same pre-existing pattern as the palette.
- **MIN-7 — header selections are not recorded to F243's Recents.** `header-search.tsx:188-191`
  is a bare `clearAndClose()` + `router.push`, whereas `components/nav/command-palette.tsx:249-255`
  `navigateAndRecord()` calls `addRecent` (used at `:330,351,389,414`). Two search surfaces,
  divergent behaviour.
- **MIN-8 — stale comment.** `header-search.tsx:32-37` asserts no other query-param-driven
  task/project detail route exists; F246's `app/(workspace)/w/[workspaceSlug]/t/[taskKey]/page.tsx`
  is exactly that. Comment only.
- **MIN-9 — `project_favorites` is a (very weak) project-existence oracle.** RLS is own-row only
  (`supabase/migrations/20260831010000_project_favorites.sql:51-69`), so a direct PostgREST
  `insert {user_id: self, project_id: <any uuid>}` succeeds for any existing project in any
  workspace and returns FK `23503` otherwise. The Server Action closes this
  (`lib/actions/favorites.ts:45-56`) but is not the only path. Targets are v4 UUIDs and no data
  is returned, so severity is minor — but the integration suite tests cross-*user* insert
  (`tests/integration/rls-project-favorites.test.ts:285-294`) and never cross-workspace insert.
- **MIN-10 — no membership-removal cleanup for favourites.** Both FKs cascade
  (`20260831010000:31-32`, tested at `rls-project-favorites.test.ts:296-328`), but removing a
  user from `project_members` leaves the row; restored access silently re-pins. Arguably desired.
- **MIN-11 — invalid HTML in the sidebar row.** `components/project-favorite-button.tsx` renders a
  real `<button>` *inside* the `<Link>` anchor (`project-nav-list.tsx:138,168`). Works in practice
  (`preventDefault/stopPropagation` at `project-favorite-button.tsx:53-57`), but interactive
  content nested in `<a>` is invalid and an AT nuisance. The star is also `opacity-0` until
  hover/focus (`:176`) while remaining in the tab order.
- **MIN-12 — favourites do not revalidate.** Neither action calls `revalidatePath`
  (`lib/actions/favorites.ts`), so the projects page's star (`projects/page.tsx:167-171`, no
  `onChange`) does not re-pin the sidebar until a full navigation. The sidebar's own local state
  (`project-nav-list.tsx:97-116`) hides this in the common case.
- **MIN-13 — no toast on client-side paste rejection.** `comment-list.tsx:585-598` renders a
  progress row only, while `attachment-list.tsx:383` fires both a row and a `toast.error`.
- **MIN-14 — `mimeType` is entirely client-declared** (`file.type`, `lib/actions/attachments.ts:93`)
  with no content sniffing, and `image/svg+xml` is allowlisted
  (`lib/validation/attachments.ts:26`). Signed URLs are cross-origin to the app, so exposure is
  limited, but stored SVGs are served with an active content type.

---

## What held up (do not re-litigate)

- **Single upload funnel — confirmed.** All four entry points call the same
  `lib/actions/attachments.ts` action: picker (`attachment-list.tsx:419→295`), drop
  (`task-detail-sheet.tsx:1055-1057`), paste (`comment-list.tsx:616-618`), extension route
  (`app/api/extension/attachments/route.ts:138`). No forked storage client, no second bucket
  path. Client validation imports the *same* constants the server's Zod schema uses
  (`lib/tasks/validate-attachment-file.ts:14-17` ← `lib/validation/attachments.ts:41-63`), and
  the server re-runs the schema at `lib/actions/attachments.ts:129` — skipping the client
  validator gains nothing. Storage path is `${uuid taskId}/${suffix}-${safeName}` with a
  uuid-validated taskId and `[^a-zA-Z0-9._-]` stripped from the name (`:227`) — no traversal.
  (The `objectPathOverride` exception is BLOCKER-3, not a funnel problem.)
- **Favourites RLS + read-query mitigation — the migration's claim is true.**
  `lib/queries/projects.ts:107-143` collects own-row favourite ids and then intersects them
  against a `createClient()` (RLS) `projects` select scoped by `workspace_id` and
  `deleted_at is null` (`:128-133`), returning **only a `Set<string>` of ids** (`:143`). Every
  rendered name/key comes from `getWorkspaceProjects` (`:51-77`). An orphaned favourite for a
  lost-access project matches nothing (`project-nav-list.tsx:124-129`) and leaks no metadata,
  while remaining toggleable — exactly as documented. Fails open to an empty set on error.
- **Guest scoping — no bypass.** The sidebar calls the *same* `getWorkspaceProjects` the projects
  page does (`lib/queries/projects.ts:51`, from `layout.tsx:230`), on the RLS client, so
  `projects_select_active_members` →`is_project_visible_to_row` applies, including F134's guest
  branch (`supabase/migrations/20260821193618_guest_role_scoping.sql:59-92`). No new unscoped
  select, no admin client on this path.
- **`ca0dc61` is a genuinely correct fix, not a compile-only one.**
  `components/board/board-column.tsx:218` ends at `… flex-1 … max-sm:w-[88vw] max-sm:min-w-0
  max-sm:flex-none max-sm:shrink-0 max-sm:snap-center`. `flex-none` = `flex: 0 0 auto`, which
  restores `flex-basis: auto` so `width` governs main-axis sizing again — not the broken
  "still `flex-1` + `w-…`" shape. The `max-sm:min-w-0` is what allowed the collapse below the
  `min-w-64` floor in the first place. The pattern does not recur: `components/board/swimlane.tsx:179`
  carries no duplicate width classes and delegates to `BoardColumn`. (Nit: the class string is a
  raw literal, not `cn()`, so the fix relies on Tailwind's variant ordering rather than
  tailwind-merge — correct today either way.)
- **F247 is not an intercepting route, so there is no mobile-sheet/back-button interaction to
  break.** No `@modal` slot and no `(.)` interceptor exists under `app/`; it is a `?taskId=`
  search-param modal (`components/task/use-task-detail-sheet.ts:20-40`). Close is guarded:
  `router.back()` only when `pushedTaskIdRef.current && window.history.length > 1` (`:143-146`),
  else `router.replace` (`:154`); double-push guarded at `:116`; `closeFromUrl` (`:167-170`)
  clears without navigating. F265 changed presentation only
  (`task-detail-sheet.tsx:1017,1069`); `onOpenChange` is untouched.
- **Header search security posture is sound.** Same `searchPalette` action as the palette, RLS
  session client plus a defense-in-depth `requireActiveMembership`, `workspaceId` from the
  server-resolved `activeWorkspace.id` (`layout.tsx:380`) which already passed the membership
  gate — no client-supplied workspace id, no cross-workspace path, `%`/`_` LIKE escaping intact,
  results rendered as text.
- **F267's task-result → bare board navigation is NOT re-flagged.** It is the identical,
  previously-accepted F242/F243 palette behaviour under AS-461.

---

## Recommended follow-up features

**FU-A (blocker, AS-518) — mobile tap-target completion pass.** Bump every interactive control
in the mobile navigation surfaces to 44px: `NotificationBell`'s trigger
(`components/notifications/notification-bell.tsx:118-119` → add `max-md:size-11`), the sidebar
project rows and the "Projects" collapsible trigger and the favourite star
(`components/nav/project-nav-list.tsx:144,168,198` → `max-md:min-h-11` / `max-md:size-11`). Then
replace the hand-picked, class-string AS-518 tests with a test that renders `AppSidebar` with a
non-empty `projects` array and asserts on *every* interactive descendant of the `md:hidden` bar
and the drawer, so a newly added control cannot silently ship under-size. Ideally back it with a
Playwright `getBoundingClientRect().height >= 44` check at 375px, since a className regex can
never express a numeric threshold.

**FU-B (blocker, AS-505) — image rows must not render the generic file icon.** Guard the
`FileText` render at `components/task/attachment-list.tsx:499-502` on
`!attachment.mimeType?.startsWith("image/")` so an image attachment shows its thumbnail *instead
of* the generic icon, as AS-505 words it. Add the negative assertion to
`tests/unit/image-lightbox.test.tsx` (icon absent on image rows, present on non-image rows) —
the current test asserts only the `<img>`'s presence and therefore passes with the defect live.

**FU-C (blocker, security) — de-export `uploadAttachmentForUser` from the Server Action surface.**
Move the shared upload implementation into a plain module (`lib/attachments/upload.ts`, no
`"use server"`), have `lib/actions/attachments.ts` export only the session-resolving
`uploadAttachment`, and have `app/api/extension/attachments/route.ts` import the plain function
directly. Replace the `objectPathOverride` parameter with a test seam that is not part of any
exported signature. While in there, sweep the repo for other exported `*ForUser` functions living
in `"use server"` modules (`createTaskForUser` is reported to have the same shape) and give each
the same treatment. Add a test asserting the action module's export surface, so a future
convenience export cannot silently re-open the hole.

**FU-D (blocker/process, AS-517) — give AS-517 a real regression guard.** Add a Playwright spec
that visits each primary workspace route at 375×812 and asserts
`document.documentElement.scrollWidth === window.innerWidth`, with an explicit allowlist for the
deliberately-scrollable containers (board, timeline, table wrappers). F266 shipped no code, no
handoff and no test, so AS-517's COMPLETE status currently rests on unreproducible run-log prose;
this is what makes it verifiable, and it will also catch the class of regression F267 could have
introduced after the manual sweep had already been signed off.

**FU-E (major, AS-515/AS-231) — gate the mobile "Move to" menu on write permission.** Pass
`moveToColumnOptions`/`onMoveToColumn` only when `canDrag` at `components/board/board.tsx:981-982`
and `:1047-1048` (or fold `canDrag` into `showMoveMenu` at
`components/board/sortable-task-card.tsx:115-116`), so a viewer is never shown a control that
optimistically moves a card and then snaps it back with an error toast. Add a `canDrag={false}`
test asserting the trigger is absent — the existing F264 suite has no viewer case at all.

**FU-F (major, AS-506/AS-507) — attachment interaction hardening.** Two related fixes: (1) add a
test that mounts the image lightbox inside the *real* task-detail Sheet and asserts a single
Escape closes the lightbox while leaving the sheet open, then wire whatever suppression that
proves necessary on `components/ui/sheet.tsx`'s dialog; (2) make cancel truthful — thread an
`AbortSignal` through `uploadOneFile` (`components/task/attachment-list.tsx:295-303`) or, since a
Server Action cannot be aborted mid-flight, reconcile the attachment list when a cancelled
upload settles successfully, so a cancelled-but-created attachment is not invisible until remount.

**FU-G (major, AS-512/AS-519/AS-521) — sidebar and header polish.** Add `shrink-0` to the primary
nav container (`components/nav/app-sidebar.tsx:178-181`) so a long project list cannot push nav
items into their own scroller on short viewports, and reconsider the fixed `max-h-64` at
`components/nav/project-nav-list.tsx:222` in favour of flex-driven sizing. Add a test that asserts
`AppHeader` is mounted by the workspace layout (AS-519 is currently unguarded at the seam).
Implement keyboard selection in the header search dropdown: active-index state, Arrow/Home/End
handling, `aria-activedescendant` + per-option ids, and a real `aria-selected` — the component
currently advertises the combobox/listbox ARIA contract while being mouse-only
(`components/nav/header-search.tsx:197-202,307-317`).

**FU-H (minor, contract) — decide AS-504's reading.** Either accept per-file *status* as
satisfying "upload progress is shown per file" and annotate the contract accordingly, or route
uploads through a `fetch`/XHR path that can emit real byte progress. The current implementation's
rationale is technically correct; what is missing is an explicit decision rather than a test that
asserts the absence of a percent sign.

---

## Toolchain output

### `npx tsc --noEmit`

```
(exit 0 — no output)
```

### `npx eslint .`

```
/Users/sasajapranin/Desktop/pm-app/lib/queries/search.ts
  280:27  warning  '_titleMatches' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/invite-member-pagination.test.ts
  186:22  warning  '_columns' is defined but never used  @typescript-eslint/no-unused-vars

/Users/sasajapranin/Desktop/pm-app/tests/unit/palette-actions-recents.test.tsx
  55:36  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  55:58  warning  '_query' is defined but never used        @typescript-eslint/no-unused-vars
  74:41  warning  '_workspaceId' is defined but never used  @typescript-eslint/no-unused-vars
  74:63  warning  '_pointers' is defined but never used     @typescript-eslint/no-unused-vars

✖ 6 problems (0 errors, 6 warnings)
```

### `npx vitest run --dir tests/unit`

```
⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯

Vitest caught 1 unhandled error during the test run.

⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯
Error: `cookies` was called outside a request scope.
 ❯ cookies node_modules/next/dist/server/request/cookies.js:131:67
 ❯ createClient lib/supabase/server.ts:10:29
 ❯ getMentionCandidates lib/actions/comments.ts:1372:26
 ❯ components/task/comment-list.tsx:300:5
This error originated in "tests/unit/user-avatar.test.tsx" test file.
(pre-existing, documented in NEXT-SESSION.md)

 Test Files  162 passed (162)
      Tests  1242 passed (1242)
     Errors  1 error
   Duration  27.96s
```

### `npx vitest run tests/integration/rls-project-favorites.test.ts tests/integration/upload-attachment.test.ts tests/integration/rls-attachments.test.ts`

```
 Test Files  3 passed (3)
      Tests  23 passed (23)
   Duration  33.34s
```

---

## Pass 2 (blockers-only re-check)

Date: 2026-08-25. Scope: verify pass-1's four blocker fixes are genuinely
correct and introduced no NEW regressions. Per the standing cap on scrutiny
cycles (NEXT-SESSION.md, "Hard-won lessons"), this is the LAST pass for M17.
Pass-1 majors/minors (AS-504, AS-506, AS-512, AS-515, AS-519, AS-521) were
deliberately not re-litigated.

### Result: no new blockers. M17 scrutiny CLOSED.

| Blocker | Fix commit | Pass 2 verdict |
|---|---|---|
| BLOCKER-1 (AS-518 mobile tap targets) | 46d13f2 / F332 | CONFIRMED FIXED, no regression |
| BLOCKER-2 (AS-505 thumbnail+icon) | 1d4e27d / F333 | CONFIRMED FIXED, no regression |
| BLOCKER-3 (uploadAttachmentForUser trust-the-parameter) | f405edb / F334 | CONFIRMED FIXED, no regression |
| BLOCKER-4 (AS-517 regression guard) | 8982b10 / F335 | CONFIRMED FIXED, guard is non-trivial |

#### BLOCKER-3 — module move, missed callers, extension auth
Repo-wide grep for `uploadAttachmentForUser` returns exactly four call
sites, all resolved: `lib/actions/attachments.ts:93` (passes the
session-resolved `user.id`), `app/api/extension/attachments/route.ts:147`,
and the two integration suites plus the new unit guard — all importing from
`@/lib/attachments/upload`. No stale `@/lib/actions/attachments` import of
the moved symbol remains anywhere. `lib/attachments/upload.ts` carries no
`"use server"` directive (verified by reading line 1 onward), and
`lib/actions/attachments.ts` exports only `uploadAttachment`,
`getAttachmentSignedUrl`, `deleteAttachment` plus types — it imports but
does not re-export the plain function, so the Server Action surface is
genuinely reduced rather than aliased. The extension route still
authenticates independently: it validates the bearer token via
`authClient.auth.getUser(token)` and 401s on `authError || !user`
(route.ts:99-109) BEFORE calling the upload function with the verified
`user.id` — identity is not caller-supplied. The added
`arrayBuffer.byteLength` validation (upload.ts:117) closes the
client-declared-size gap without changing the route's own early
`MAX_ATTACHMENT_SIZE_BYTES` check. `objectPathOverride` still exists but is
now only reachable by direct server-side import, which is the intended
post-fix posture.

#### BLOCKER-1 — breakpoint-prefix consistency
The prefix question was checked against the established convention rather
than assumed. The codebase uses BOTH prefixes, split by surface: `max-sm:`
for content-area/sheet controls (sheet.tsx close button, board columns,
sortable-task-card, task-detail-sheet) and `max-md:` for navigation chrome
(`app-sidebar.tsx:204`, `:254`, `:356` — F265's own AS-518 fixes). F332's
four additions are all navigation chrome (project nav rows, the favorite
button inside them, the Projects group header, the notification bell in the
mobile top bar), so `max-md:` is the CORRECT and consistent choice here, not
an inconsistency. No double-application: each control gains exactly one
sizing utility, and where a base size exists (`size-7` on
ProjectFavoriteButton, `size-8` from `size="icon"` on the bell) the
`max-md:` variant is a distinct tailwind-merge group and wins only below
768px, leaving desktop sizing untouched. The bell renders in both the
desktop sidebar header and the mobile top bar; because `max-md:` is a
max-width query and the sidebar header is not shown below `md`, the desktop
instance is unaffected.

#### BLOCKER-2 — non-image rows still show the icon
The condition is a strict complement: the thumbnail renders on
`mimeType?.startsWith("image/")`, the `FileText` icon on the negation
`!attachment.mimeType?.startsWith("image/")`. PDFs, docs and any
non-image MIME keep the icon; an attachment with a null/undefined
`mimeType` also keeps the icon (`!undefined` → true), which is the safe
default. Both directions are covered by tests that would fail if the
behaviour flipped: `image-lightbox.test.tsx` asserts
`queryByTestId('attachment-file-icon-<id>')` is absent for an image and
`getByTestId` present for `spec.pdf`, with `queryByAltText('spec.pdf')`
absent proving no thumbnail leaks onto non-images. Row layout (`flex
items-center gap-2`) degrades cleanly with the icon removed — no orphaned
spacer.

#### BLOCKER-4 — guard is not trivially true
The new spec is not a vacuous check. It seeds a real workspace, an
owner-role member (so settings/members and settings/audit render content
rather than an access-denied screen), a project with a deliberately
overlong name, and three tasks with long titles and due dates so board
cards, list rows, calendar chips and timeline bars all have real content —
the spec's own comment names the "an empty board would trivially pass"
failure mode and seeds against it. It asserts
`document.documentElement.scrollWidth <= window.innerWidth` at 375x812
across 14 primary routes plus the mobile-nav-open state, and dismisses the
F253 onboarding overlay up front so the overlay isn't what's being
measured. Measuring the document root (not inner `overflow-x-auto`
wrappers) is the right call: deliberately scrollable containers don't grow
the root, but removing one of those wrappers would, so the guard has real
failure sensitivity.

### Toolchain (pass 2)

- `npx tsc --noEmit` — clean, zero output.
- `npx eslint .` — 0 errors, 6 pre-existing warnings (unused `_`-prefixed
  vars in `lib/queries/search.ts:280`,
  `tests/unit/invite-member-pagination.test.ts:186`,
  `tests/unit/palette-actions-recents.test.tsx:55,74`). None introduced by
  the four fixes.
- `npx vitest run tests/unit` — 163 files, 1248 tests, all passing. One
  unhandled serialized error (`E251`) surfacing from
  `getMentionCandidates` during `user-avatar.test.tsx`; pre-existing noise,
  unrelated to M17's fixes, no test failure.
- `npx next build` — succeeds, full route manifest emitted.
- Integration: `extension-attachments.test.ts`,
  `f323-sibling-action-project-visibility.test.ts`,
  `rls-attachments.test.ts` — 52/52 tests PASS. The f323 suite reports a
  failed *suite* due to its `afterAll` cleanup hook exceeding the 30s
  hookTimeout (line 233, sequential per-row admin deletes against a remote
  Supabase); this is teardown slowness, not an assertion failure and not a
  behaviour regression from the module move. Flagged as a minor test-hygiene
  follow-up, NOT a blocker.

### Follow-ups (non-blocking, for a future milestone)

The f323 integration suite's `afterAll` teardown deletes rows one id at a
time in sequential awaits against a remote Supabase instance and exceeds the
default 30s hookTimeout, marking an otherwise fully-passing suite as failed.
A future maintenance feature should batch these deletes with `.in("id",
ids)` per table and/or raise this suite's `hookTimeout`, so the suite's
red/green signal reflects assertions rather than network latency during
cleanup.
