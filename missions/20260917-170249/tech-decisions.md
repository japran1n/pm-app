# Tech decisions — HTML → Webflow converter

_Mission: 20260917-170249_

## Stack

- Language: TypeScript 5.9.3  <!-- already pinned in pm-app's node_modules; confirmed via `require('typescript/package.json').version` on 2026-09-17, no change needed -->
- Framework: Next.js 16.3.5 with App Router  <!-- already pinned in pm-app's package.json (^16.3.5) and matches `npm view next@16.3.5 version` on 2026-09-17 — this mission adds no new framework dependency -->
- Runtime for the conversion engine: Node.js, via a Next.js Server Action (`"use server"`) — not the browser. See "Architecture" below.
- No database, no auth provider, no new external service. The route inherits pm-app's existing Supabase-backed workspace session/auth from the shared `/w/[workspaceSlug]/*` layout; the conversion logic itself never queries Supabase.

## Architecture: why the engine runs server-side, not client-side

The standalone prototype (`~/Desktop/html-to-webflow`) ran its equivalent
engine in a small Node HTTP server and its UI as a separate static page. For
pm-app, the natural instinct is to run the whole thing client-side (paste →
convert → copy, no round trip) since the conversion touches no user data.
That was evaluated and rejected:

`node-html-parser` is a Node-oriented HTML parser. A web search on
2026-09-17 ("node-html-parser browser compatible webpack bundle client-side")
found that Node-based HTML parsers commonly pull in Node-specific
dependencies when a bundler tries to include them in a client bundle — a
documented failure mode, not merely a theoretical one
(<!-- verified against https://zirkelc.dev/posts/bundling-node-browser and https://webpack.js.org/guides/native-html as of 2026-09-17 -->).
Fighting Turbopack/webpack configuration to force a Node parser into a client
bundle is exactly the kind of fragile, hard-to-debug setup this mission
should avoid, especially for an internal tool. Running the parser in a
Server Action costs one network round trip (irrelevant at this scale — pasted
sections are a few KB) and requires zero bundler configuration, because
Server Actions already run in Node.

This still satisfies discovery's "no Supabase needed, stateless" constraint:
the action reads and writes nothing external. It is a pure function call
across the client/server boundary that already exists in every Next.js App
Router app, not an integration with a third-party service.

## Libraries used

- `node-html-parser@9.0.4`  <!-- verified against `npm view node-html-parser version` on 2026-09-17 -->
  HTML → simplified DOM tree, used server-side only inside the Server Action. Same choice the standalone prototype already proved works for this exact task.
- `postcss@8.5.28`  <!-- already present in pm-app's node_modules as a Tailwind 4 transitive dependency; version confirmed via `require('postcss/package.json').version` on 2026-09-17 — add it as an explicit devDependency so it can't silently disappear if Tailwind's internals change -->
  CSS → AST, used to walk selectors/declarations/media queries. Also already proven in the prototype.
- No other new runtime dependency. Everything else (React, Tailwind, the project's existing UI primitives, `vitest`) is already in pm-app.

## Libraries explicitly avoided

- **Tailwind JIT / any Tailwind-compilation library** — out of scope for v1 per discovery (round 1, Q7). Adding one now would be premature; Tailwind input is treated as plain class names.
- **A code editor library (CodeMirror/Monaco)** — discovery (round 1, Q19) chose plain read-only text for the JS output box; a full editor is unjustified weight for a paste-only field.
- **A client-side HTML/CSS parser purpose-built for the browser** (e.g. `linkedom`, `happy-dom`) — considered as an alternative to solve the client-side-bundling problem above, but rejected: it would mean maintaining two parser codepaths (or migrating away from the already-proven `node-html-parser`/`postcss` combination) for a problem the Server Action architecture avoids entirely. Not worth the churn for an internal tool.
- **Old CommonJS-only html-parser alternatives** (e.g. `htmlparser2` used directly, `cheerio` with jQuery-style API) — `node-html-parser`'s DOM-like API is a closer match to the already-proven prototype code being ported; no reason to re-architect during a port.

## File layout

```
app/(workspace)/w/[workspaceSlug]/tools/webflow/
  page.tsx                          — route entry (Server Component, membership-gated by the shared layout)

components/webflow-tool/
  converter-page.tsx                — client assembly: editor + preview + results
  converter-editor.tsx               — 3-tab HTML/CSS/JS input, localStorage persistence
  converter-preview.tsx              — sandboxed live-preview iframe
  converter-results.tsx              — stats, warnings, errors, custom-code box
  converter-verify.tsx               — clipboard verify/debug box
  converter-help.tsx                 — in-app contract explanation

lib/webflow-converter/               — pure engine, server-safe, zero DOM/browser dependency
  longhand.ts
  css.ts
  typemap.ts
  emit.ts
  validate.ts
  convert.ts
  *.test.ts                          — colocated, matches pm-app's existing test convention

lib/webflow-converter-client/        — the one piece that MUST run in the browser
  clipboard.ts                       — synchronous copy-event clipboard write

lib/actions/
  webflow-converter.ts               — "use server" action: (html, css, js) -> convert() result
  webflow-converter.test.ts
```

## External services needed

None. This feature introduces zero new external services, zero new
credentials, and zero new entries in `.env`. It uses only what pm-app already
has (Next.js runtime, existing Supabase session for the page-level auth
check it inherits from the shared layout). Per this mission's own discovery
answers, `/mission-connect` should find nothing to configure.

## How to run the app

```bash
npm run dev
```
<!-- unchanged from pm-app's existing script, verified in package.json -->

## How to run tests

```bash
npm test
```
<!-- unchanged from pm-app's existing script; vitest 4.1.11 is already installed and pinned — npm's registry lists 5.0.1 as current, but upgrading the project's test runner is out of scope for this feature and is not done here -->

## How to run linter

```bash
npm run lint
```

## How to run type-check

```bash
npm run build
```
<!-- pm-app has no separate `tsc --noEmit` script; the build step is what CI/prior missions have used as the type-check gate -->

## Conventions

- **Server Action pattern**: follow `lib/actions/chat-channels.ts` / `lib/actions/docs.ts` for the lightweight `auth.getUser()`-only gate (no workspace-resource authorization needed here — no workspace data is read or written). Do not use `withAuthz` (`lib/actions/authz.ts`), which is for workspace/resource-scoped writes and would be the wrong tool for a stateless compute action.
- **Naming**: kebab-case files, matching the rest of `lib/actions/` and `components/`.
- **Comments**: this repo's convention is to tag non-obvious decisions with the originating feature/assertion, e.g. `// F017 (AS-095, AS-098): images become empty...`. Follow it — several features in this mission (F014, F017, F019) contain deliberate departures from the reference prototype that future readers need explained inline, not just in the mission's own files.
- **Tests**: colocated `*.test.ts` next to the module under test, matching existing files like `components/nav/project-nav-list.test.tsx`.
- **Error handling**: the pure engine (`lib/webflow-converter/`) never throws for expected bad input (unsupported selector, unmappable media query, etc.) — those become entries in the `warnings` array. It only throws for genuinely unparseable input (e.g. no HTML at all), which the Server Action (F023) converts into `{ok: false, message}`.
- **No feature flag**: this ships as a normal always-on route, per `plan.md`'s Rollout section.
- **Reuse before building**: before adding any new UI primitive (tabs, buttons, dialogs), check `components/ui/` for an existing one first — this repo has an established shadcn-style primitive set.
