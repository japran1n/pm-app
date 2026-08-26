# M19 — QA feedback browser extension: scrutiny report (PASS 1)

Scope: F280–F300. Assertions AS-531–AS-572. Deliverables: the Chrome MV3 extension in
`extension/`, the three Route Handlers in `app/api/extension/{tasks,context,attachments}/`, and
the `app/(auth)/extension-connect/` handoff page.

Context: this is the **first scrutiny pass M19 has ever had**. Every feature F280–F300 has its
own `feat(F___)` commit and its own independent-verification log entry, and plan.md's
`[COMPLETE]` tags for the range were backfilled by a later session. But the milestone was never
subjected to a milestone-boundary adversarial review, and **five commits landed on `extension/`
AFTER the per-feature verifications that materially changed what the milestone delivers** —
those post-hoc changes are where most of what follows lives.

Per the user's standing cap (`NEXT-SESSION.md` § "Hard-won lessons": M15 six passes, M16/M17/M18
two each, blockers-only past pass 1), this is **PASS 1**. Majors/minors are recorded but should
not on their own drive another round.

Method: four parallel reviewers reading code and tests only (no handoffs passed in); two
terminated on API errors and their areas were re-covered by this validator directly. Every
finding below was independently re-verified by this validator against the cited file and against
`git log`/`git show` — none is relayed on a reviewer's word alone.

## Toolchain (this validator, current tree)

- `npx tsc --noEmit` (main app) — **exit 0, no output.**
- `npx eslint .` (main app) — **exit 0, 0 errors**, 6 pre-existing unused-var warnings (identical
  set to M18 scrutiny's).
- `npx vitest run tests/unit` — **168 files / 1339 tests, all passed.** Exit 1 solely from the
  known pre-existing `user-avatar.test.tsx` unhandled-rejection artefact M18 scrutiny already
  recorded. No test failures.
- `npx next build` — **exit 0**, full route manifest emitted.
- `extension`: `npm run typecheck` — **exit 0**. `npm run lint` — **exit 0**.
- `extension`: `npm run build` — **exit 0**; `check-no-secret-key: PASS`; `dist.zip` written
  (135146 bytes, 20 entries, no sourcemaps, no `.env`).
- `extension`: `npx playwright test` — **81 passed / 0 failed, exit 0.**

**M19 has not broken the main app.** Nothing in this report is a regression of M1–M18.

## Verdict: **NOT GREEN — 5 blockers (9 assertions).**

Two of the five are *contract-reconciliation* blockers rather than code defects: functionality
the contract requires was deliberately deleted after the fact (one of them explicitly at the
user's request), and nothing in `plan.md` or `validation-contract.md` was ever updated to say
so. Those need a documented scope amendment, **not** re-implementation. The other three are live
code defects.

---

## Assertion table

| ID | Verdict | Reason |
|---|---|---|
| AS-531 | PASS | MV3 manifest loads, popup opens on toolbar click; `tests/popup.spec.ts:29` exercises a real Chrome context. |
| AS-532 | PASS (major) | Handoff design is sound (server-minted AES-256-GCM 60s single-use token, no `postMessage`, no `externally_connectable`). But the test hand-writes a fake session into storage and never exercises the page→content-script→worker path — MAJ-4. |
| AS-533 | PASS | `app/(auth)/extension-connect/page.tsx:29-50` renders the sign-in prompt + `/sign-in?next=/extension-connect`; test asserts the opened URL and the absence of credential inputs. |
| AS-534 | PASS | Session lives in disk-backed `chrome.storage.local` (`src/lib/chrome-storage-adapter.ts:19-30`); fresh persistent context rehydrates. |
| AS-535 | PASS (major) | Design genuinely holds — no auth state in worker memory. But the test opens a second popup page rather than killing/respawning the worker, and says so — MAJ-5. |
| AS-536 | PASS | Failed refresh clears storage and fires `SIGNED_OUT` → "Session expired. Please reconnect." The `expired`-vs-`signed_out` race is deliberately handled (`Popup.tsx:344`). **No stale-token window found**: the popup's `accessToken` only ever comes from `getSession()`/`onAuthStateChange`, never a side cache. Test routes a real 400 `invalid_grant` and asserts the storage key is gone. |
| AS-537 | PASS | `signOut()` + `chrome.storage.local.clear()`; test asserts storage is empty. |
| AS-538 | PASS (minor) | Verified by this validator against a fresh build: only `sb_publishable_…` appears in `dist/`; zero `service_role` occurrences. Vite sets no `envPrefix`, so only `VITE_`-prefixed vars inline. `dist/` and `dist.zip` are both gitignored. Scanner is narrower than the assertion's wording — MIN-1. |
| AS-539 | **FAIL (major)** | There is no longer any control that captures the whole visible area. The single `capture-button` (`Popup.tsx:470`) calls `handleSelectRegion`, and `tests/capture-visible-tab.spec.ts:497` **asserts the whole-tab flow is "fully gone"** — MAJ-1. |
| AS-540 | PASS | Region select + crop; DPR≠1 covered by `tests/capture-visible-tab.spec.ts:314`. |
| AS-541 | PASS | Not swallowed. `visible-tab.ts:64-78` produces distinct actionable text for restricted-page vs ungranted-host; persisted to storage + badge so it survives popup close; exercised against a real `chrome://` page. |
| AS-542 | PASS | Arrow, rectangle, freehand, text all commit as discrete ops; tests assert on decoded canvas pixels. |
| AS-543 | PASS | Real op-stack undo/redo with redo invalidated on new commit (`canvas.tsx:180,383-399`). |
| AS-544 | PASS | **Cleared as a security question.** Blur is destructive raster block-averaging over `getImageData`/`putImageData` (`tools/blur.ts:57-99`), on the same shared path used by both live redraw and export (`flatten.ts:37`). Not a CSS filter, not an overlay, not a re-applied vector op. Block-averaging is information-destroying. The test decodes the **exported PNG bytes**. Two non-blocking notes in MIN-2. |
| AS-545 | PASS (major) | Traced end to end: `report-form.tsx:364-368` prefers `getAnnotatedResult()` (the `flattenToPng` output) and the raw full-tab capture never leaves the service worker. Separately, "Cancel annotations" does not discard them — MAJ-2. |
| AS-546 | PASS | Element picker records the pointed-at element. |
| AS-547 | **FAIL (blocker)** | The picker collects `rect` and the popup displays it, but the **report drops it**: `report-form.tsx:409` sends `{ selector }` only, `DescribeElement` is `{ selector: string }` (`describe.ts:36-38`), and `buildTaskDescription` emits only `Selector:`. Position and size never reach the server — BLOCKER-1. |
| AS-548 | **FAIL (blocker)** | Records the **popup's** URL, viewport and DPR, not the page's — BLOCKER-2. |
| AS-549 | **FAIL (major)** | `reporterId`/`reporterEmail`/`capturedAt`/`timeZone` are collected then dropped by `DescribeEnvironment`. Identity survives implicitly (server resolves it from the bearer JWT), but the recorded instant is task-creation time, not capture time — MAJ-3. |
| AS-550 | **FAIL (blocker)** | Console capture **does not exist**. Deleted by `439403d` — BLOCKER-3. |
| AS-551 | **FAIL (blocker)** | Same. The bounded ring buffer was deleted with it — BLOCKER-3. |
| AS-552 | **FAIL (blocker)** | Same — BLOCKER-3. |
| AS-553 | **FAIL (blocker)** | Network-error capture **does not exist**. Deleted by `439403d` — BLOCKER-3. |
| AS-554 | **FAIL (blocker)** | The privacy toggles **do not exist** — BLOCKER-3. (Note: this is not a "user thinks capture is off while it still happens" hole. Nothing is captured at all, so it fails safe.) |
| AS-555 | PASS | Workspace/project/status pickers present and exercised against a real task creation. |
| AS-556 | PASS | Title, description, assignee, priority, due date all present and pass through `extensionCreateTaskSchema`. |
| AS-557 | **FAIL (blocker)** | The context route returns **every** project in the workspace including `visibility='private'` ones the caller cannot see — BLOCKER-4. |
| AS-558 | PASS | `tests/report-form.spec.ts:219` submits through the real route and creates a real task. |
| AS-559 | PASS | Annotated bytes upload via `app/api/extension/attachments`. |
| AS-560 | PASS | Metadata is appended after a `---` delimiter, reporter's text byte-for-byte first. Readable form is fine; the *values* are wrong per BLOCKER-2. |
| AS-561 | PASS | Identity comes only from `auth.getUser(token)`; `extensionCreateTaskSchema` has no identity-shaped field to trust. |
| AS-562 | PASS | `requireActiveMembership` at the route, and `createTaskForUser` re-checks membership, `canWrite`, and `isProjectVisibleToCaller`. Non-member rejection exercised live. |
| AS-563 | PASS (major) | Real server-computed task key via `formatTaskKey`. The link is the **board** URL under a documented "F246 hasn't landed" fallback — but the deep-link route **does** exist — MAJ-6. |
| AS-564 | PASS | Preferences persist; a remembered workspace the caller lost access to is silently ignored rather than force-selected (good). |
| AS-565 | PASS | Draft (fields + image) is persisted to `chrome.storage.local` and survives; six distinct error classes each have a distinct message, all exercised live. |
| AS-566 | PASS | Client checks size before creating the task; route re-checks with a message naming the limit; `uploadAttachmentForUser` additionally re-validates the **real** `arrayBuffer.byteLength`, not the declared size. |
| AS-567 | PASS | `tasks` has no attachment-reference column, so "task with no attachment" is a valid state, and the storage-first-then-insert-with-cleanup ordering is proven against real Storage via the `objectPathOverride` seam. |
| AS-568 | PASS (minor) | `permissions: [activeTab, storage, scripting]`, no `<all_urls>`, content script scoped to the connect page only. Justifications present and test-enforced. MIN-3. |
| AS-569 | PASS | `activeTab` + `scripting` means capture works on an arbitrary never-seen page with no setup. (The localhost hardcoding is a *packaging* defect — BLOCKER-5 — not an AS-569 one.) |
| AS-570 | PASS | Keyboard-only annotation placement and full-flow keyboard test present and passing. |
| AS-571 | **FAIL (blocker)** | The build runs and produces a zip, but the artifact is hard-wired to `http://localhost:3000` and cannot work against any deployment — BLOCKER-5. |
| AS-572 | PASS | Missing / malformed / expired tokens all 401. Identity is never read from the payload, so "belongs to a different user than the payload claims" is unrepresentable by construction. |

---

## BLOCKERS

### BLOCKER-1 — the recorded element reference loses its position and size (AS-547)

`extension/src/capture/element-picker.ts:248` collects the element's `rect`, and `Popup.tsx:577`
even shows it to the reporter. But at the submit boundary:

```ts
// extension/src/popup/report-form.tsx:409
element: pickedElement ? { selector: pickedElement.selector } : null,
```

`DescribeElement` is `{ selector: string }` (`src/submit/describe.ts:36-38`) and
`buildTaskDescription` emits only a `Selector:` line (`describe.ts:80`). The rect is discarded at
the popup boundary and never reaches the server. AS-547 explicitly requires "a CSS selector **and
the element's position and size**."

The suite does not catch this because `tests/element-picker-selector.spec.ts:288` asserts on the
**picker's return value**, which does contain the rect. It never follows that value into the
submitted description. Textbook test-mirrors-implementation: it tests the boundary the
implementation happens to draw, not the assertion's intent.

### BLOCKER-2 — every report records the extension popup's URL, viewport and DPR, not the page's (AS-548)

`collectEnvironmentMetadata` is called from `report-form.tsx:402`, which executes **inside the
extension popup document**, and reads ambient globals:

- `environment.ts:198` — `globalThis.location?.href` → `chrome-extension://<id>/...`
- `environment.ts:207-208` — `globalThis.window?.innerWidth/innerHeight` → the ~380px popup
- `environment.ts:221` — `globalThis.window?.devicePixelRatio` → the popup's

Verified by this validator: there is **no fallback** — `pageUrl` appears in only two places in
the whole tree (`environment.ts:80` and `:271`), and nothing anywhere in `src/popup/` calls
`chrome.tabs.query` or reads `tab.url`. So every QA report filed by this extension states the
extension's own URL as the page under test and the popup's dimensions as the viewport. For a bug
-reporting tool whose entire value is "attach the real technical context," this is the most
consequential functional defect in the milestone.

The test **codifies the defect explicitly** (`tests/environment-metadata.spec.ts:122-123`):

```ts
expect(result.pageUrl).toBe(realState.href);
expect(result.pageUrl.startsWith("chrome-extension://")).toBe(true);
```

That second line asserts the URL *is* an extension URL. It locks the wrong behaviour in against
the assertion's plain meaning. Per this review's standing rule, a passing test that confirms the
implementation rather than the assertion's intent does not rescue the assertion.

The fix is cheap: both the region overlay and the element picker already run in the page, and
`element-picker.ts:249` already collects the page's real `window.innerWidth/innerHeight`.

### BLOCKER-3 — five contracted assertions have no implementation at all (AS-550, AS-551, AS-552, AS-553, AS-554)

Grepping the entire `extension/src/` tree for `console-hook`, `network-hook`, `webRequest`,
`consoleEntries`, `networkError`, `captureConsole` returns **zero matches**. `extension/tests/`
contains no console, network, or privacy spec. `src/submit/describe.ts:23` states it outright:

> Console/network log capture support has been removed entirely (not needed)

Git confirms this was implemented, verified, and then deleted:

```
f84cab9 feat(F291): persistent per-user toggles gate console/network capture hooks [AS-554]
4f47a46 feat(F290): capture failed fetch/XHR requests into a bounded, redacted buffer [AS-553]
723acd9 feat(F289): bounded, gesture-triggered console/error capture [AS-550, AS-551, AS-552]
...
439403d chore(extension): remove console/network log capture, not needed
```

`439403d` deleted `console-hook.ts`, `network-hook.ts`, `ring-buffer.ts`, `privacy-toggles.ts`,
`popup/privacy-toggles.tsx` and all three of their spec files.

**Provenance matters here, and the commit is honest about it:** "Removes console-log and network
-request capture entirely from the QA feedback extension **per explicit user request** — this
capability is not needed and should be gone, not just hidden." That commit is careful, thorough,
and well-verified on its own terms.

So this is a **contract-reconciliation blocker, not a code defect, and the remedy is NOT to
re-implement it.** What actually went wrong is bookkeeping, and it is a hard-rule violation:
`validation-contract.md` is immutable once `APPROVED` exists, so a scope reduction has to be
recorded — F289/F290/F291 are still tagged `[COMPLETE]` in `plan.md`, and AS-550–AS-554 still
stand unqualified in the contract, describing five behaviours the shipped product does not have
and is not intended to have. Anyone reading mission state today would conclude this extension
captures console errors. It does not.

One point in the removal's favour, worth stating plainly: because nothing is captured at all,
AS-554's underlying privacy risk — "a user thinks capture is off while it is still happening" —
**cannot occur**. This fails safe.

### BLOCKER-4 — the extension context route leaks private projects (AS-557)

`app/api/extension/context/route.ts:165-170`:

```ts
admin
  .from("projects")
  .select("id, name")
  .eq("workspace_id", workspaceId)
  .is("deleted_at", null)
  .order("name", { ascending: true }),
```

This runs on the **admin client, which bypasses RLS by design**, and applies no `visibility`
filter and no `isProjectVisibleToCaller` check. Every project in the workspace — including
`visibility = 'private'` projects the caller is not a `project_members` row for — is returned to
the extension by id and name.

This is the exact rule F322/F323 exists to enforce. `lib/actions/project-visibility.ts:9-17` says
so in its own doc comment: every task-scoped action reads through the admin client, "so the
visibility check RLS would otherwise provide has to be re-run explicitly here." The sibling
routes in this very milestone get it right — `uploadAttachmentForUser` calls
`isProjectVisibleToCaller` (`lib/attachments/upload.ts`), and so does `createTaskForUser`
(`lib/tasks/create.ts:159`). Only the context route skips it.

Impact is bounded but real:
- **Disclosure:** private project names and ids leak to workspace members with no access. F323
  deliberately returns a generic message elsewhere so "a private project's existence is never
  disclosed" — this route discloses it directly.
- **Not a write hole:** `createTaskForUser` independently re-checks visibility, so a caller who
  picks a leaked project gets rejected. The defense-in-depth held.
- **UX:** the picker offers projects that will always fail on submit.

The test suite cannot catch this: `tests/integration/extension-context.test.ts`'s four AS-557
cases are *entirely* cross-workspace (A vs B). Not one exercises intra-workspace private-project
scoping. AS-557 says "only those the signed-in user actually has access to" — the tests only ever
check the workspace half of "access."

### BLOCKER-5 — the packaged artifact is hard-wired to localhost and cannot run against any deployment (AS-571)

`extension/manifest.json` hardcodes the dev origin in three places, and this validator confirmed
it survives verbatim into `dist/manifest.json` and `dist.zip`:

```json
"host_permissions": ["http://localhost:3000/*"],
"content_scripts": [{ "matches": ["http://localhost:3000/extension-connect*"] }],
"web_accessible_resources": [{ "matches": ["http://localhost:3000/*"] }]
```

Meanwhile the app origin the code talks to is build-time configurable via `VITE_APP_URL`
(`.env.example`, `src/lib/supabase.ts:35`). `vite.config.ts:11` imports the manifest statically
(`import manifest from "./manifest.json"`) and no build step rewrites it — verified by reading
the config and diffing source vs built manifest.

Consequence: build with a production `VITE_APP_URL` and you get a zip in which the content script
never runs on the real connect page and the worker has no host permission for the exchange fetch.
**The session handoff silently fails and the extension is unusable.** AS-571 asks for "a
distributable artifact"; the artifact builds reproducibly but is not distributable.

`.env.example`'s own comment compounds the trap by describing `VITE_APP_URL` as "where the
content script is allowed to run (extension-connect.ts, matched narrowly in manifest.json)" —
implying the manifest tracks the env var. It does not.

`tests/permissions-minimisation.spec.ts:55` asserts source and built manifests declare the *same*
permission set — which is exactly why it passes: it compares the two hardcoded copies to each
other and never asks whether either matches the configured origin.

---

## MAJOR

- **MAJ-1 (AS-539)** — the whole-visible-area capture control was replaced by a region-first flow
  (`fbe8a3f feat(extension): select-portion-first capture flow, replacing capture-then-crop`).
  `captureVisibleTab` still runs internally as the crop source, so the capability exists, but no
  control invokes it and `tests/capture-visible-tab.spec.ts:497` now **enforces its absence**.
  Same reconciliation problem as BLOCKER-3, smaller: a deliberate post-verification UX change
  never reconciled with an immutable assertion. Unlike BLOCKER-3, this commit does not attribute
  itself to a user request.
- **MAJ-2 (AS-545)** — "Cancel annotations" does not discard them. `clearAnnotatedResult` and
  `clearLastCapture` are defined (`capture/store.ts:29,65`) and **never called anywhere in
  `src/`**; `handleAnnotationCancel` (`Popup.tsx:238-241`) returns the UI to `cropped` but leaves
  `currentAnnotated` set, so a reporter who cancels still submits the previously-confirmed
  annotated image. Errs on the private side (a blurred image is sent, never an unblurred one), so
  not a leak — but Cancel does not cancel.
- **MAJ-3 (AS-549)** — reporter identity and `capturedAt` are collected then dropped from the
  description. Identity survives via the bearer token server-side; the capture *moment* does not
  survive at all (only the row's `created_at`).
- **MAJ-4 (AS-532)** — `tests/session-handoff.spec.ts:114-137` hand-writes a fake session into
  `chrome.storage.local` and asserts the popup renders it. **It would still pass if
  `extension-connect.ts`, the exchange route, and `mintExtensionHandoffToken` were all deleted.**
  The single highest-risk path in the milestone has no end-to-end coverage.
- **MAJ-5 (AS-535)** — the test opens a second popup page rather than killing and respawning the
  service worker, and candidly says so at lines 104-111. The design property genuinely holds; the
  test proves something weaker than the assertion states.
- **MAJ-6 (AS-563)** — F296 took a documented fallback to the board URL on the grounds that it
  "grepped `app/` and found no `[taskKey]`/task-detail dynamic route" (`success.tsx:10-12`). That
  grep was wrong: the route exists at
  `app/(workspace)/w/[workspaceSlug]/t/[taskKey]/page.tsx` — it is under the `(workspace)` route
  group, and `npx next build` emits `ƒ /w/[workspaceSlug]/t/[taskKey]`. F246 had landed in M17,
  exactly as `plan.md`'s own ordering note anticipated. The fallback was taken unnecessarily and
  the reporter is dropped on a board instead of the task they just filed.
- **MAJ-7 (replay window)** — extension handoff single-use enforcement is an in-process `Set`
  (`lib/extension-handoff.ts:46,99,144`), self-documented as not surviving restarts or spanning
  serverless instances. With a 60s TTL and a token that only ever exists in the user's own DOM,
  exposure is small — but on a multi-instance deploy the "one-time" property degrades to TTL-only.

## MINOR

- **MIN-1 (AS-538)** — `scripts/check-no-secret-key.mjs:26` matches only
  `/sb_secret_[A-Za-z0-9_-]{16,}/`. Correctly name-agnostic (catches an `sb_secret_*` value under
  any var name), and the negative test proves it isn't vacuous. But it would not catch a legacy
  `service_role` JWT, `SUPABASE_JWT_SECRET`, or a database password. Non-blocking — this project
  uses the new key format — but narrower than the assertion's wording.
- **MIN-2 (AS-544)** — `BLUR_BLOCK_SIZE = 16` is in *physical* pixels, so on a DPR-2 capture a
  block covers ~8 CSS px. Still illegible in practice, but the header comment's stated rationale
  ("a lowercase character is usually well under 16px") does not hold at DPR≥2. Alpha is averaged
  along with RGB — harmless on an opaque screenshot.
- **MIN-3 (AS-568)** — the content-script match `http://localhost:3000/extension-connect*` also
  matches `/extension-connect-anything`; harmless since only pm-app serves that origin.
  `service-worker.ts:257` does not assert `sender.url`/`sender.id` on `EXTENSION_HANDOFF_TOKEN`
  — not exploitable (only same-extension senders reach `onMessage`) but cheap defense in depth.
  The exchange endpoint is the one auth endpoint with no `EXTENSION_ID` origin guard.
- **MIN-4** — `element-picker.ts:107-166` is a hand-maintained duplicate of `selector.ts`'s
  algorithm, synced "by comment cross-reference" (`:41-42`). The unit tests exercise
  **`selector.ts`** — the copy that never runs in production. Drift would be invisible to most of
  the suite.
- **MIN-5** — `selector.ts:81-95` embeds `data-*` attribute **values** verbatim after trying
  `data-testid`, so a `data-user-email`/`data-customer-id` value can end up in the selector string
  sent to the server. Inherent to selector generation and low severity, but the loop tries every
  `data-*` in arbitrary order rather than restricting to known-stable test hooks. **Note: the
  generator does NOT emit `textContent`, `class`, `aria-label`, or input `value`** — the serious
  version of this concern was checked and is clean.
- **MIN-6** — `selector.ts:89,99` contains dead code (a double-escaped `selector` computed then
  discarded via `void selector`). `crop.ts:99,106` decodes the image twice on the DOM path.
- **MIN-7** — `dist/` ships icons twice (`icons/` and `public/icons/`), ~1.5KB of pure bloat.
- **MIN-8** — sign-out calls `chrome.storage.local.clear()`, which also destroys preferences and
  pending captures. Probably intended; wider than AS-537's wording.

---

## What held up

Several things in this milestone are genuinely well built, and it is worth saying which, because
the blocker list above is not representative of the whole:

- **The auth handoff design is the strongest part of the milestone.** There is no `postMessage`
  anywhere in the flow, no `externally_connectable`, the content script is scoped to a single
  path on a single origin (never `<all_urls>`), `all_frames` is unset so an attacker iframing the
  connect page gets nothing, the handoff token is opaque and useless without a server round-trip,
  and identity is resolved server-side from the token rather than from any payload. The specific
  attack this review went looking for — a malicious page forging or intercepting a session — is
  **not available.**
- **The bug class this mission has now been bitten by twice — F334's `uploadAttachmentForUser` and
  F336's `createTaskForUser` trusting a caller-supplied identity — is NOT reproduced here.** All
  three extension routes resolve identity solely from `auth.getUser(token)`; the plain-module
  (non-`use server`) discipline is correctly maintained and correctly explained at both call
  sites; `extensionCreateTaskSchema` has no identity-shaped field to trust in the first place. The
  attachment path re-checks membership, `canWrite`, *and* project visibility against the task's
  real owning workspace. This was the highest-prior-probability finding going in and it came back
  clean.
- **Blur is genuinely destructive**, on a single shared code path for live rendering and export,
  and its test decodes the exported PNG bytes rather than inspecting state. The "sensitive data
  ships to the server anyway" failure mode does not exist.
- **AS-566's double size check is better than the assertion requires**:
  `uploadAttachmentForUser` re-validates the **real** `arrayBuffer.byteLength`, not just the
  client-declared `fileSize`, closing the exact evasion M17 scrutiny found.
- **AS-565's error taxonomy is real work** — six distinct failure classes (offline, expired
  session, non-member, oversized, generic 500, retry-success) each with a distinct message, each
  exercised live against a real server, with the draft persisted *before* the network attempt.
- **AS-564 handles the ugly case**: a remembered workspace the caller no longer has access to is
  silently ignored rather than force-selected.
- **The extension's own toolchain is clean and its suite is honest where it counts** — 81/81
  green, typecheck and lint at exit 0, `dist.zip` free of sourcemaps and `.env`, both `dist/` and
  `dist.zip` correctly gitignored, and the AS-538 check backed by a negative test that plants a
  fake secret and proves the scanner fires.

---

## Recommended follow-up features

**FU-1 (blocker, AS-548) — capture environment metadata from the page under test, not the popup.**
`collectEnvironmentMetadata` currently runs in the popup document and reads its own ambient
`location`/`window`, so every report carries `chrome-extension://…` as the page URL and the ~380px
popup as the viewport. Move page-scoped collection (URL, viewport width/height, devicePixelRatio)
into the injected content-script context that already runs in the page — the element picker
already collects the page's real `window.innerWidth/innerHeight` at `element-picker.ts:249`, and
the region overlay runs there too — and pass those values into the popup rather than re-deriving
them. Browser name/version and OS may legitimately stay popup-side (they are process-wide). This
must also **correct `tests/environment-metadata.spec.ts:123`**, which currently asserts
`result.pageUrl.startsWith("chrome-extension://")` and would otherwise fail the fix; the replacement
test should open a real page at a known URL and non-popup viewport size and assert the submitted
description contains *that* URL and *those* dimensions — following the value into the description,
not stopping at the collector's return value.

**FU-2 (blocker, AS-547) — carry the picked element's position and size into the report.**
Widen `DescribeElement` (`src/submit/describe.ts:36-38`) from `{ selector }` to include the rect
the picker already collects at `element-picker.ts:248`, stop discarding it at
`report-form.tsx:409`, and have `buildTaskDescription` render position and size as readable lines
alongside `Selector:`. The test must assert on the **submitted description string**, not on the
picker's return value, since the existing test at `element-picker-selector.spec.ts:288` already
passes against the broken behaviour by stopping at that boundary. While in this file, consider
restricting the `data-*` fallback loop (`selector.ts:81-95`) to a known-stable allowlist so
PII-bearing attribute values are not embedded in selectors (MIN-5).

**FU-3 (blocker, AS-557) — scope the extension context route to projects the caller can actually
see.** `app/api/extension/context/route.ts:165-170` selects every project in the workspace on the
RLS-bypassing admin client with no visibility filter, leaking private project names and ids to
workspace members who are not project members. Filter the result through the existing
`isProjectVisibleToCaller` helper (`lib/actions/project-visibility.ts`) using the membership role
the route has already resolved at line 155 — the same helper `createTaskForUser` and
`uploadAttachmentForUser` already use, so the rule stays in exactly one place. Select `visibility`
in the query so the helper can be applied without a second round trip, and prefer a single batched
`project_members` lookup over a per-project call. Add an integration case to
`tests/integration/extension-context.test.ts` covering the gap its four existing AS-557 cases all
miss: a private project **inside** the caller's own workspace, absent for a plain member, present
for a workspace admin and for an explicit `project_members` row.

**FU-4 (blocker, AS-571) — make the packaged extension target its configured origin.**
`manifest.json` hardcodes `http://localhost:3000` in `host_permissions`, `content_scripts.matches`
and `web_accessible_resources.matches`, and `vite.config.ts:11` imports it statically with no
rewrite, so a production build silently ships a manifest that cannot reach the app it was built
for. Generate those three fields from `VITE_APP_URL` at build time (a small transform passed to
`crx({ manifest })`, or a pre-build step that emits the manifest), fail the build loudly if
`VITE_APP_URL` is unset or unparseable, and correct `.env.example`'s comment, which currently
implies the manifest already tracks the variable. Strengthen
`tests/permissions-minimisation.spec.ts:55` — it presently compares the two hardcoded copies to
each other, which is why it passes today — to assert the built manifest's origins match the
configured `VITE_APP_URL`. Fold in MIN-7 (icons emitted twice) while in the build config.

**FU-5 (blocker-as-bookkeeping, AS-550–AS-554, and AS-539) — reconcile the contract with the
deliberately reduced scope.** Console capture, network-error capture and the privacy toggles were
implemented, independently verified, and then deleted in `439403d` **at the user's explicit
request**; the whole-visible-area capture control was likewise replaced by the region-first flow
in `fbe8a3f`. **Do not re-implement any of this.** The defect is that mission state still claims
otherwise: F289/F290/F291 remain tagged `[COMPLETE]` in `plan.md`, and AS-550–AS-554 and AS-539
still stand unqualified in `validation-contract.md`, describing six behaviours the shipped product
deliberately does not have. Since the contract is immutable once `APPROVED` exists, the correct
remedy is an append-only amendment: add a dated "scope reductions" section to
`validation-contract.md` recording each withdrawn assertion, the commit that withdrew it, and the
authority for it; retag the affected features in `plan.md` as `[WITHDRAWN]` (or equivalent) rather
than `[COMPLETE]`; and note the reduction in `README.md`/`store-listing.md` so the extension is not
described as capturing console errors. This is an orchestrator/documentation task, not a worker
code task, and it should land before M19 is called green.

**FU-6 (major, AS-563) — link the reporter to the task, not the board.** F296 fell back to the
board URL after grepping for a `[taskKey]` route and missing it because the route lives under the
`(workspace)` route group; it does exist, at
`app/(workspace)/w/[workspaceSlug]/t/[taskKey]/page.tsx`, and `next build` emits it as
`ƒ /w/[workspaceSlug]/t/[taskKey]`. Have `app/api/extension/tasks/route.ts` return a
`taskPath` built from the workspace slug and the `formatTaskKey` value it already computes at line
221, keep `boardPath` as a genuine fallback for the null-slug case, and have `success.tsx` prefer
the task link. Update the stale comment at `success.tsx:10-12`. Cheap, and it closes the loop the
milestone was designed around.

**FU-7 (major, AS-532/AS-535/AS-545) — close the three coverage and correctness gaps in the
session and annotation paths.** Three small, related items. (a) The AS-532 test hand-writes a fake
session into `chrome.storage.local` and would pass with the entire handoff deleted — add one
genuine end-to-end case that loads the real `/extension-connect` page with a signed-in server
session and asserts the extension ends up connected without any storage seeding. (b) The AS-535
test opens a second popup page instead of terminating the service worker — use Playwright's
service-worker handle to stop and respawn it, so the assertion is tested rather than approximated.
(c) `clearAnnotatedResult`/`clearLastCapture` (`capture/store.ts:29,65`) are defined but never
called, so `handleAnnotationCancel` (`Popup.tsx:238-241`) leaves the prior annotated image in place
and Cancel silently does nothing — wire them up and cover it.

---

## Full toolchain output

### `npx tsc --noEmit` (main app)
```
(no output)
tsc exit=0
```

### `npx eslint .` (main app)
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

eslint exit=0
```

### `npx vitest run tests/unit`
```
 Test Files  168 passed (168)
      Tests  1339 passed (1339)
     Errors  1 error
   Duration  28.77s

(the 1 error is the pre-existing tests/unit/user-avatar.test.tsx unhandled rejection
 in getMentionCandidates -> lib/actions/comments.ts:1372 -> cookies(), __NEXT_ERROR_CODE E251,
 already recorded in M18-scrutiny.md. No test failed.)
vitest exit=1 (from the unhandled rejection only)
```

### `npx next build` (main app)
```
next build exit=0
... full route manifest emitted, including:
├ ƒ /w/[workspaceSlug]/t/[taskKey]        <-- the deep-link route MAJ-6 refers to
ƒ Proxy (Middleware)
```

### `extension`: `npm run typecheck` / `npm run lint`
```
> pm-app-extension@0.1.0 typecheck
> tsc --noEmit
typecheck exit=0

> pm-app-extension@0.1.0 lint
> eslint .
lint exit=0
```

### `extension`: `npm run build` (from a clean `rm -rf dist dist.zip`)
```
> node scripts/sync-version.mjs && vite build && node scripts/check-no-secret-key.mjs && node scripts/zip.mjs

sync-version: manifest.json already at 0.1.0 — no change.
vite v8.2.1 building client environment for production...
✓ 82 modules transformed.
dist/service-worker-loader.js                   0.04 kB
dist/public/icons/icon16.png                    0.17 kB
dist/public/icons/icon48.png                    0.37 kB
dist/src/popup/index.html                       0.77 kB │ gzip:  0.47 kB
dist/public/icons/icon128.png                   0.93 kB
dist/manifest.json                              1.25 kB │ gzip:  0.51 kB
dist/assets/popup-DDsxZpRB.css                  5.34 kB │ gzip:  1.47 kB
dist/assets/extension-connect.ts-8xkWSY0u.js    0.28 kB │ gzip:  0.23 kB
dist/assets/service-worker.ts-De6aCMZE.js       7.67 kB │ gzip:  2.85 kB
dist/assets/upload-Di2_BntD.js                210.36 kB │ gzip: 54.64 kB
dist/assets/popup-BJTQJ2mO.js                 230.69 kB │ gzip: 71.26 kB

✓ built in 97ms
check-no-secret-key: PASS — no "sb_secret_" string found anywhere in dist/.
Wrote /Users/sasajapranin/Desktop/pm-app/extension/dist.zip (135146 bytes)

dist.zip: 20 files, 459408 bytes uncompressed. No *.map, no .env, no source.
Bundle secret scan (this validator): 0 occurrences of "service_role";
  only sb_publishable_mYzIh_mR... present. AS-538 holds.
git check-ignore: extension/dist.zip (.gitignore:43), extension/.env (.gitignore:3),
  extension/dist (.gitignore:27) — all ignored. git ls-files extension: only .env.example tracked.
```

### `extension`: `npx playwright test`
```
  81 passed (2.2m)
playwright exit=0
```
(Suite contains no console-capture, network-capture, or privacy-toggle spec — all three were
deleted by 439403d. See BLOCKER-3.)
