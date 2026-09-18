# M7 + M8 Scrutiny — 20260917-170249 (round 1)

Verdict: **RED**. 5 assertions FAIL (2 blockers, 3 majors), 1 INCONCLUSIVE.

## IMPORTANT: assertion-text mismatch in the validator brief

The brief handed to this validator paraphrased AS-011 and AS-129..AS-134 with
texts that do **not** match `validation-contract.md` (immutable).

| ID | Brief said | Contract actually says |
|---|---|---|
| AS-011 | "Engine has zero Supabase/auth/fetch dependencies" | "The converter **page** does not read from or write to any Supabase table." |
| AS-129 | "only accessible to authenticated workspace members" | "does not persist, list, or browse previously converted sections — nothing saved **server-side**" |
| AS-130 | "No data persisted between sessions" | "does not offer any pre-built component library or template gallery" |
| AS-131 | "route is /w/[slug]/tools/webflow" | "does not create/modify/read any account, team or permission record beyond the existing membership check" |
| AS-132 | "converter is stateless" | "does not attempt Tailwind utility-class compilation or grouping in v1" |
| AS-133 | "no external network calls" | "does not attempt real Webflow form-element construction in v1" |
| AS-134 | "does not write to any Supabase table" | "does not auto-detect GSAP plugins or inject any CDN script tag" |

Adjudicated against the **contract**, per Hard Rule 5. The orchestrator should
fix the brief before the next milestone; a validator run against paraphrases is
worthless. Findings that the paraphrases would have caught are preserved below
as out-of-scope observations.

## Results

| ID | Verdict | Reason |
|---|---|---|
| AS-121 | **FAIL** (major) | `bg-blue-500` — Tailwind static palette, not a derived token — `converter-editor.tsx:134`. Also `bg-white` at `converter-preview.tsx:47`. |
| AS-122 | **FAIL** (major) | `converter-preview.tsx:47` puts `bg-white` on the iframe **element** (which carries `rounded-md border`, i.e. app chrome). Pinned to light theme; no dark counterpart, no token. |
| AS-123 | **FAIL** (major) | `converter-verify.tsx:43` strips the focus ring (`focus:outline-none`) with no `focus-visible:` replacement, on the one control whose purpose is "focus me and paste". WCAG 2.4.7. Plus `converter-results.tsx:82`: an `overflow-y-auto` scroll region with no `tabIndex`, keyboard-unreachable (WCAG 2.1.1). |
| AS-125 | PASS (minor defects) | Every button has a text name; tests use `getByRole("button",{name})` so they genuinely defend it. Defects: `⌘⏎` span not `aria-hidden` pollutes the Convert button's name (`converter-page.tsx:153`); `aria-label` on a bare `<span>` is dropped by AT (`converter-editor.tsx:132-136`). |
| AS-126 | **FAIL** (blocker) | jsx-a11y is **not registered** in `eslint.config.mjs`. Only 6 rules leak in transitively via `eslint-config-next`, all severity `warn`, none keyboard- or label-related. `click-events-have-key-events`, `interactive-supports-focus`, `tabindex-no-positive`, `label-has-associated-control`, `control-has-associated-label` are all OFF. Running the plugin's own recommended config over these files surfaces a real `label-has-for` error at `converter-results.tsx:74` that repo lint cannot see. The green `npm run lint` is a false signal. |
| AS-128 | **INCONCLUSIVE** (major) | Two-column layout is correctly guarded (`min-w-0 flex-1`, `converter-page.tsx:126,136`) and the custom-code `<pre>` has `overflow-x-auto`. Unguarded vector: the warnings `<ul>` at `converter-results.tsx:64` has `overflow-y-auto` only — no `overflow-x`, no `break-words`, no `min-w-0` on the parent — and its strings are built verbatim from **user input** (`css.ts:163,187,189,197` interpolate raw selectors and dot-joined class chains with no break opportunity). Needs a browser check at ~1440px with a 200-char selector injected. |
| AS-011 | PASS | Zero `.from(`/`.insert`/`.update`/`.upsert`/`.delete`/`.rpc` in `lib/actions/webflow-converter.ts`, `components/webflow-tool/`, `lib/webflow-converter/`. The only Supabase touch is `getCurrentUser()` → `auth.getUser()`, an Auth-server read, not a table. The action destructures only `{ user }`, so it has no client in scope to write with. |
| AS-129 | PASS | Nothing is saved server-side; no list/browse UI exists. (Editor content is restored client-side from localStorage — client-side, so not an AS-129 violation. See observations.) |
| AS-130 | PASS | No component library, template gallery, preset or snippet UI anywhere in `components/webflow-tool/`. |
| AS-131 | PASS | Page adds zero auth logic; membership is enforced entirely by the pre-existing slug layout (`app/(workspace)/w/[workspaceSlug]/layout.tsx:157-218`, RLS-scoped `getWorkspaceBySlug` → `notFound()` for non-members). No account/team/permission record is created, modified, or read beyond that check. |
| AS-132 | **FAIL** (major) | Behavioural, not just untested. `validator.ts:24` `CLASS_NAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/` rejects `:` and `[]`, and `validator.ts:136-137` raises a **hard error**. I ran `convert()` directly to confirm: `class="flex gap-4 text-sm"` -> OK, payload non-null, zero errors. But `class="md:w-1/2 hover:bg-red-500"` -> **payload `null`**, errors `Style class name "md:w-1/2" is not a valid Webflow class name` (+1). And `class="w-[32px] bg-[#fff]"` -> **payload `null`**, 2 errors. Responsive variants and arbitrary values are ordinary Tailwind; they do not degrade to "plain class names like any other class" — they kill the entire conversion. |
| AS-133 | PASS | `typemap.ts:149-158` degrades `<form>`/form controls to a plain div **and emits a warning** naming FormWrapper/FormForm. No Webflow form construction attempted. |
| AS-134 | PASS | `js-extract.ts:3-4` explicitly declines GSAP plugin auto-detection and CDN auto-injection; no CDN/unpkg/jsdelivr/ScrollTrigger string exists in the engine. External `src` scripts are carried through as text, never fetched. |

## Cross-cutting: the tests do not defend most of these assertions

The 490 scoped tests pass, but passing is not the question. Specific gaps:

1. **Zero styling/layout tests.** No test in `components/webflow-tool/*.test.tsx`
   asserts AS-121, AS-122 or AS-128. Changing `bg-blue-500` to any colour,
   deleting every `min-w-0`, or removing `overflow-x-auto` leaves the suite green.
2. **Zero keyboard tests.** Grep across all six test files for `userEvent`,
   `toHaveFocus`, `document.activeElement` returns **no matches**. Every
   activation is `fireEvent.click`. Not one test presses Tab. Nothing asserts
   the AlertDialog traps or restores focus — swap Base UI for a hand-rolled
   overlay and the suite stays green. `converter-help.test.tsx:24,35` queries
   the disclosure by `getByText`, not `getByRole`, so replacing `<summary>`
   with a click-only `<div>` passes while the help section becomes
   keyboard-unreachable. This is the textbook "test mirrors implementation" shape.
3. **`convert.test.ts:391` is a false-green test — its UI half matches zero
   files.** The walker at `convert.test.ts:406` filters on
   `entry.name.toLowerCase().includes("webflow")` — the *file* name, not the
   path. The real files are `components/webflow-tool/converter-page.tsx` and
   `app/(workspace)/w/[workspaceSlug]/tools/webflow/page.tsx`; neither filename
   contains "webflow". I re-ran that exact walker standalone against `app/` and
   `components/`: **`matched files: 0 []`**. The loop at `convert.test.ts:432-435`
   therefore asserts over an empty array and can never fail. Worse,
   `scanRoots` (`:429`) is `app` + `components` only, so
   `lib/actions/webflow-converter.ts` — the one file that actually touches
   Supabase — is never scanned. The scan is also bare string-match on
   `"supabase"`, so a regression routed through a db helper passes.
4. **`lib/webflow-converter/dependency.test.ts` is misnamed and tests nothing
   about dependencies.** All 24 lines are a `node-html-parser` smoke check.
   Adding a Supabase import or a `fetch()` to `emit.ts`, or adding a whole new
   engine file that does either, passes unchanged.
5. **`js-extract.test.ts:4` names AS-134 in its `describe` title, but not one of
   its 12 cases contains `gsap`, a plugin name, or a CDN URL.** A mutant that
   injected a ScrollTrigger CDN tag on detecting `gsap.registerPlugin` would
   pass every test in the file. Coverage theatre: it reads as covered in any
   assertion-to-test traceability sweep while enforcing nothing.
6. **AS-129, AS-130, AS-131 have no test at all** — they rest on prose comments
   (`convert.ts:6`, `page.tsx:11-27`). The team already knows the pattern:
   `converter-page.test.tsx:62` `test_AS_022_no_viewport_preset_controls` is
   exactly the negative-UI test these three need.
7. **AS-133 is the one well-defended assertion** — `typemap.test.ts:114-127`
   asserts `type === "Block"`, `tag === "div"` and the warning text, and would
   fail on regression. Gap is minor: unit-level on `getWebflowType` only, no
   integration test proving the warning survives into `convert()` output (it
   does; verified manually).
4. **`lib/actions/webflow-converter.test.ts:4` claims AS-011 is "verified
   structurally, see the comment."** A pointer to a comment is not a test.
   Genuinely good: the `</script>` escaping test (lines 114-136) captures the
   HTML handed to the engine and would fail if the escape were removed.

## Out-of-scope observations (not M7/M8 assertion failures — route to the orchestrator)

- **Server Action has no membership check.** `lib/actions/webflow-converter.ts:50-53`
  checks only that a user exists. A Server Action is a directly-invocable POST
  endpoint; the layout gate never runs for it. Any authenticated user — including
  a `client`-role user the layout explicitly ejects from `/w/*` at
  `layout.tsx:322`, and a user with zero memberships — can invoke it. The action
  takes no workspace parameter, so it is structurally incapable of enforcing
  membership. No data exposure (it reads/writes nothing), but it is uncapped
  compute through postcss: a DoS amplification vector. Belongs to AS-004/AS-012.
- **localStorage is unscoped by user.** `converter-editor.tsx:21-23,35-52` uses
  keys `webflow-converter:html|css|js` with no user or workspace prefix and no
  `removeItem` anywhere on sign-out. On a shared machine, user B sees user A's
  pasted HTML — which can carry credentials in inline JS. Intended behaviour per
  AS-021, but the scoping is a real privacy bug.
- **`let idCounter` at `lib/webflow-converter/emit.ts:95,102`** — module-level
  mutable state, never reset, shared across all conversions in a process. Only
  reached on the `crypto.randomUUID` fallback path, so latent rather than active.
- **`longhand.ts:19` uses `require()`** in an ESM `.ts` file — it would escape
  any import-only static dependency check.

## Recommended follow-up features

**FU-A (blocker, AS-126): Register eslint-plugin-jsx-a11y properly.** Add
`eslint-plugin-jsx-a11y` to `package.json` devDependencies as a direct dep and
register it in `eslint.config.mjs` with its `flat.recommended` config for
`**/*.tsx`, promoting at minimum `click-events-have-key-events`,
`no-static-element-interactions`, `interactive-supports-focus`,
`tabindex-no-positive`, `label-has-associated-control` and
`control-has-associated-label` to `error`. Fix every violation the newly-live
rules surface across the repo, or scope the config to `components/webflow-tool/**`
plus the route if a repo-wide sweep is too large for one feature — but the
converter must be covered at error severity, not warn. Confirm by showing
`npx eslint --print-config` listing the keyboard/label rules as severity 2.
The known existing hit is `label-has-for` at `converter-results.tsx:74`.

**FU-B (blocker, AS-123 + AS-125): Fix the converter's keyboard and naming
defects.** Replace `focus:outline-none` on the verify box
(`converter-verify.tsx:43`) with the repo's standard
`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
treatment used by `components/ui/button.tsx:10` and `textarea.tsx:10`; add
`aria-multiline="true"` and an `onKeyDown` fallback. Replace the dead
`<label htmlFor>` → `<pre>` association in `converter-results.tsx:74-85` with a
`<p id>` plus `aria-labelledby` on the `<pre>`, and give the `<pre>`
`tabIndex={0}` so its scroll region is keyboard-reachable. Add `aria-hidden="true"`
to the `⌘⏎` span (`converter-page.tsx:153`) and `aria-keyshortcuts="Meta+Enter"`
to the button. Convert the bare-span `aria-label` at `converter-editor.tsx:132-136`
into `<span className="sr-only">`. Scope the global Cmd+Enter listener
(`converter-page.tsx:104-114`) so it does not fire while a dialog is open or
while focus is inside the contentEditable box.

**FU-C (major, AS-121 + AS-122): Replace the two palette literals.** Change
`bg-blue-500` at `converter-editor.tsx:134` to a semantic token (`bg-primary`).
Move `bg-white` off the iframe **element** at `converter-preview.tsx:47` — the
element is app chrome and must take a token; if the simulated page genuinely
needs a white canvas, hardcode it on the `<body>` inside `buildSrcDoc`
(`converter-preview.tsx:15-27`) where it belongs to the user's document. While
in these files: add `font-mono` to the custom-code `<pre>`
(`converter-results.tsx:80-84`) so it uses Source Code Pro rather than the
browser's generic monospace, and switch `text-warning` on `bg-warning/10`
(`converter-results.tsx:61`) to `text-warning-foreground` — `--warning-lightness`
is 0.8 in light theme, so the current pairing is light-on-light.

**FU-D (major, AS-128): Contain user-derived warning strings.** Add
`overflow-x-auto break-words` (or `[overflow-wrap:anywhere]`) to the warnings
`<ul>` at `converter-results.tsx:64` and `min-w-0` to its flex parent at
`converter-results.tsx:43`, so a pathological selector cannot widen the page.
Ship with a test that renders the results panel with a 300-character
unbroken class-chain warning and asserts the containment classes are present,
plus a Playwright check at 1440x900 asserting
`document.documentElement.scrollWidth <= clientWidth` after a conversion whose
input contains such a selector.

**FU-F (major, AS-132): Decide and fix Tailwind class handling.** Today
`validator.ts:136-137` fatals the entire conversion on any class containing `:`
or `[]`, so realistic Tailwind input (`md:`, `hover:`, `w-[32px]`) returns a
null payload rather than degrading. Either sanitize such names into valid
Webflow class names and emit a warning, or downgrade the error to a
per-class skip-with-warning so the rest of the payload still converts. AS-132
is immutable, so if the product decision is "fatal error is correct", that must
be recorded under a NEW assertion ID rather than by editing AS-132. Ship with
tests using genuinely Tailwind-shaped input for all three cases above. Also
clarify whether "the standard class-defined-but-not-styled behavior" implies a
user-visible warning — currently an HTML class with no CSS rule produces an
empty-`styleLess` style silently, and the only "not used" warning
(`convert.ts:100`) fires in the opposite direction.

**FU-E (major, test enforcement for AS-011/AS-134): Fix the false-green purity
test and make `dependency.test.ts` real.** First repair `convert.test.ts:406`
to match on **path** rather than filename and extend `scanRoots` to include
`lib/actions/` and `components/webflow-tool/` — as written it scans zero UI
files. Then: Rewrite it to glob `lib/webflow-converter/**/*.ts`
(excluding `*.test.ts`) from disk, extract every `import ... from "x"` **and**
`require("x")` specifier (the CJS form matters — `longhand.ts:19` uses it), and
assert the external allowlist is exactly `{postcss, node-html-parser,
css-shorthand-properties}`. Separately assert no engine file's source matches
`/\bfetch\s*\(|supabase|XMLHttpRequest|node:(http|https|dns|fs)/`. Add a
matching assertion over `lib/actions/webflow-converter.ts` and
`components/webflow-tool/**` for `.from(`/`.insert(`/`.upsert(`/`.rpc(`. Globbing
is the point: a new file must be caught by construction, not by someone
remembering to update a list. Also add a keyboard-behaviour test file using
`userEvent.tab()` asserting every control in the converter is reachable in order
and that the Clear-all dialog restores focus to its trigger on cancel.

## Note on the full test run

`npx vitest run` (whole repo) reports 252 failed files / 173 failed tests. These
are `tests/integration/**` suites failing with `TypeError: fetch failed` against
a live Supabase instance — environmental, not caused by this milestone. The
milestone-scoped run is fully green (18 files, 490 tests). Recommend the
orchestrator confirm this integration failure count matches the pre-milestone
baseline; it was not verified here.

---

# Raw output

## `npx vitest run lib/webflow-converter/ components/webflow-tool/ lib/webflow-converter-client/ lib/actions/webflow-converter.test.ts`

```
 RUN  v4.1.11 /Users/sasajapranin/Desktop/pm-app

 Test Files  18 passed (18)
      Tests  490 passed (490)
   Duration  2.52s
```

## `npx tsc --noEmit`

```
(no output — exit 0)
```

## `npm run lint`

```
> pm-app@0.1.0 lint
> eslint

(no output — exit 0)
```

## `npx eslint --print-config components/webflow-tool/converter-page.tsx` (jsx-a11y rules only)

```
6 a11y rules enabled
  jsx-a11y/alt-text                  [1, {elements: [img], img: [Image]}]
  jsx-a11y/aria-props                [1]
  jsx-a11y/aria-proptypes            [1]
  jsx-a11y/aria-unsupported-elements [1]
  jsx-a11y/role-has-required-aria-props  [1]
  jsx-a11y/role-supports-aria-props      [1]
```

All severity 1 (warn). None keyboard- or label-related. This is the AS-126 blocker.

## `npx vitest run` (full repo)

```
 Test Files  252 failed | 497 passed | 1 skipped (750)
      Tests  173 failed | 3661 passed | 1687 skipped (5521)
   Duration  151.67s
```

Representative failure (environmental — no live Supabase):

```
 FAIL  tests/integration/workspace-role-expansion.test.ts > AS-238
 Error: Failed to create test workspace: TypeError: fetch failed
   ❯ createWorkspace tests/integration/workspace-role-expansion.test.ts:121:13
```
