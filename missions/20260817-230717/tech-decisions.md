# Tech decisions

_Mission: 20260817-230717_ _Written: 2026-08-17_

## Stack

- Language: TypeScript 5.1+ (Next.js 16's floor) <!-- verified against https://nextjs.org/docs/app/guides/upgrading/version-16 as of 2026-08-17 -->
- Framework: Next.js 16.3.x, App Router, Turbopack (default in 16, no flag needed) <!-- verified against https://nextjs.org/docs/app/guides/upgrading/version-16 as of 2026-08-17 -->
- React: 19.2 (bundled canary via Next 16 App Router) <!-- verified against https://nextjs.org/docs/app/guides/upgrading/version-16 as of 2026-08-17 -->
- Database: Supabase Postgres <!-- verified against https://supabase.com/docs as of 2026-08-17 -->
- Auth: Supabase Auth, magic link, with new key format (`sb_publishable_*` client-side / `sb_secret_*` server-only) <!-- verified against https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys as of 2026-08-17 — legacy anon/service_role JWT keys are being phased out by end of 2026, so this mission uses the new keys from the start -->
- Storage: Supabase Storage (private bucket, signed URLs) <!-- verified against https://supabase.com/docs as of 2026-08-17 -->
- Realtime: Supabase Realtime (Postgres logical replication) on `tasks` and `comments` <!-- verified against https://supabase.com/docs as of 2026-08-17 -->
- UI: Tailwind CSS + shadcn/ui, installed via `npx shadcn@latest init` (CLI v4) <!-- verified against https://ui.shadcn.com/docs/changelog/2026-03-cli-v4 as of 2026-08-17 -->
- Hosting: Vercel <!-- per discovery round-1 Q21 -->

## Important Next.js 16 breaking changes this mission must follow

<!-- verified against https://nextjs.org/docs/app/guides/upgrading/version-16 as of 2026-08-17 -->

- `middleware.ts` is renamed to `proxy.ts`; the exported function is `proxy`, not `middleware`. Workers must use this filename/export from the start, not migrate later.
- `params` and `searchParams` in pages/layouts/routes are `Promise`-typed and MUST be awaited. There is no synchronous compatibility mode left (v15 had one temporarily; v16 removed it).
- `cookies()`, `headers()`, `draftMode()` are async-only.
- `revalidateTag(tag)` requires a second argument (a `cacheLife` profile, e.g. `revalidateTag('tasks', 'max')`). The single-argument form is a type error.
- Turbopack is the default bundler for both `next dev` and `next build` — no `--turbopack` flag needed, and a custom Webpack config will fail the build unless `--webpack` is passed explicitly (not needed for this project; no custom Webpack config planned).
- `next lint` is removed. Lint via ESLint CLI directly (`eslint .`), flat config.
- `images.domains` is deprecated; use `images.remotePatterns` if external avatar/image URLs are ever needed (not required for v1 — attachments are Storage-signed URLs, not `next/image` remote sources).

## Libraries used

- `@supabase/ssr` ^0.12.4 <!-- verified against npm as of 2026-08-17, latest published 14 days prior --> — cookie-based SSR-safe Supabase client for Server Components, Server Actions, and `proxy.ts`.
- `@supabase/supabase-js` ^2.x (installed alongside `@supabase/ssr` per Supabase's own Next.js quickstart template `with-supabase`) <!-- verified against https://supabase.com/docs/guides/getting-started/quickstarts/nextjs as of 2026-08-17 -->
- `zod` ^4.4.3 <!-- verified against npm as of 2026-08-17 --> — Server Action input validation (AS-146).
- `@dnd-kit/core` + `@dnd-kit/sortable` ^6.3.1 <!-- verified against npm as of 2026-08-17; last publish is older but the package is stable/maintained and is the de facto standard for accessible React drag-and-drop, superseding `react-dnd` used by the reference app --> — Kanban board drag-and-drop; chosen over `react-dnd` (used by the reference implementation) for built-in keyboard/screen-reader support relevant to AS-151/AS-152.
- `recharts` (current major via npm at install time) — dashboard bar/pie charts; same library the reference app used, still current and works cleanly with React Server/Client Component split.
- `@sentry/nextjs` ^10.70.0 <!-- verified against npm as of 2026-08-17 --> — error monitoring per discovery Q24.
- `date-fns` (current major via npm at install time) — date formatting/comparison (overdue detection, relative comment timestamps).
- `lucide-react` (current major via npm at install time) — icon set matching shadcn/ui's default.
- Dev/tooling: `eslint` + `@next/eslint-plugin-next` (flat config, since `next lint` is removed in v16), `typescript`, `prettier`, `playwright` (for the AS-150 E2E test), `vitest` (unit tests — faster startup than Jest for a Next.js + TS project, no CRA-era Jest config baggage).

## Libraries explicitly avoided

- `react-dnd` — the reference app's choice; unmaintained pace and weaker accessibility story than `@dnd-kit`. Not used.
- `@mui/material` + `@mui/x-data-grid` — the reference app's second, conflicting design system alongside Tailwind. Replaced entirely by shadcn/ui + Tailwind per the user's explicit stack constraint; running two design systems was flagged as a defect in the reverse-engineering pass.
- `gantt-task-react` — Timeline/Gantt view is explicitly out of scope for v1 per description.md.
- AWS Cognito / `aws-amplify` / `@aws-amplify/ui-react` — replaced entirely by Supabase Auth per the user's stack constraint.
- Prisma — Supabase's official Next.js pattern uses the `@supabase/ssr` client directly against Postgres with RLS as the authorization boundary; adding an ORM on top would duplicate the RLS layer's job and is unnecessary indirection for this project's size.
- `next-auth` / Auth.js — superseded for this project by Supabase Auth, which is bundled with the chosen database and already covers magic-link + session cookies.
- Legacy Supabase `anon`/`service_role` JWT keys — deprecated in favor of `sb_publishable_*`/`sb_secret_*` (see Stack section); this mission starts on the new keys rather than migrating later.
- `next lint` — removed in Next.js 16; ESLint is invoked directly instead.

## File layout

```
.
├── app/
│   ├── (auth)/
│   │   ├── sign-in/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (workspace)/
│   │   ├── onboarding/page.tsx              # create-first-workspace
│   │   └── w/[workspaceSlug]/
│   │       ├── layout.tsx                    # workspace switcher, membership guard
│   │       ├── page.tsx                      # dashboard (AS-125..136)
│   │       ├── settings/
│   │       │   └── members/page.tsx          # invites, roles (AS-007..024)
│   │       ├── search/page.tsx                # AS-116..124
│   │       └── projects/
│   │           ├── page.tsx                   # project list (AS-027..042)
│   │           └── [projectId]/
│   │               ├── layout.tsx              # Board/List tabs
│   │               ├── board/page.tsx          # AS-067..084
│   │               └── list/page.tsx           # AS-085..093
│   ├── layout.tsx
│   └── proxy.ts                                # renamed from middleware.ts (Next 16)
├── components/
│   ├── ui/                                     # shadcn/ui generated components
│   ├── board/  (BoardColumn, TaskCard, DragOverlay)
│   ├── task/   (TaskDetailSheet, CommentList, AttachmentList)
│   └── dashboard/ (PriorityBarChart, StatusPieChart)
├── lib/
│   ├── supabase/ (client.ts, server.ts, proxy.ts helpers)
│   ├── actions/  (Server Actions: tasks.ts, projects.ts, comments.ts, attachments.ts, workspaces.ts)
│   └── validation/ (Zod schemas mirroring actions/*)
├── supabase/
│   ├── migrations/                             # SQL migrations incl. RLS policies
│   └── seed.sql
├── tests/
│   ├── unit/       (vitest — position math, Zod schemas, RLS helper logic)
│   └── e2e/        (playwright — AS-150 board reorder + auth smoke)
├── .env.example
└── README.md
```

## External services needed

- **Supabase** — MCP available and official. <!-- verified against https://supabase.com/blog/supabase-is-now-an-official-claude-connector as of 2026-08-17 --> `claude mcp add --scope project --transport http supabase "https://mcp.supabase.com/mcp?features=docs,database,debugging,development,functions&project_ref=<PROJECT_REF>"` — a single project-scoped registration in `.mcp.json`, shared by the orchestrator and every worker/validator subagent in this repo (there is no separate per-role MCP registration mechanism in Claude Code; one registration serves the whole session tree). `project_ref` is passed explicitly to lock the server to this one project rather than the account's full project list. `read_only` is intentionally omitted — workers need write access to apply migrations (F011 onward touch `supabase/migrations/`). Needs: Project URL, `sb_publishable_*` key (client), `sb_secret_*` key (server-only, never shipped to client). First use requires a one-time in-session approval of the MCP server (Claude Code trust prompt) — this is a human-only step, not automatable via Bash.
- **Playwright** — MCP available (`@playwright/mcp`, Microsoft's official package). <!-- verified via search as of 2026-08-17 --> Install via `claude mcp add playwright npx @playwright/mcp@latest`. Used by the ux-validator agent. No credentials needed.
- **Sentry** — no official MCP confirmed as of this search; integrated via the `@sentry/nextjs` SDK directly. Needs: DSN (public, safe to expose), and an auth token only for source-map upload in CI (kept as a GitHub Actions secret, not in `.env`).
- **Vercel** — deployment target; no MCP needed for this mission's scope (deploy happens via `vercel` CLI / git integration, set up manually by the user post-mission per the "what you do" list — the orchestrator does not need Vercel credentials for `/mission-run` to complete).
- **GitHub** — repository hosting for CI (GitHub Actions). MCP available but not required for this mission's scope; `git`/`gh` CLI via Bash is sufficient.

## How to run the app

```
npm install
npm run dev
```

## How to run tests

```
npm run test && npx playwright test
```

## How to run linter

```
npx eslint .
```

## How to run type-check

```
npx tsc --noEmit
```

## Conventions

- **Naming:** Database tables/columns `snake_case`; TypeScript `camelCase`, converted at the Supabase client boundary (generated types via `supabase gen types typescript`, not hand-written).
- **File organization:** one Server Action file per domain entity (`lib/actions/tasks.ts`, not one per action) — keeps related mutations and their Zod schemas together.
- **Error handling:** Server Actions return a discriminated-union result (`{ ok: true, data } | { ok: false, error: string }`), never throw across the Server Action boundary into a Client Component. Unexpected/unhandled errors are caught, logged to Sentry, and surfaced as a generic message — the underlying error is never shown raw to the user (relevant to AS-146/AS-148).
- **Authorization:** every Server Action that touches workspace-scoped data re-verifies the caller's membership at the top of the function (AS-143), even though RLS is the actual enforcement boundary. Treat RLS as the last line of defense, not the only line.
- **RLS policy pattern:** every workspace-scoped table's policies join through `workspace_members` on `auth.uid()` — no table trusts a `workspace_id` value passed from the client without checking membership.
- **Soft delete:** every soft-deletable entity uses a nullable `deleted_at timestamptz` column; all `SELECT`s used by the app (including RLS policies backing Realtime) filter `deleted_at IS NULL`. Never a boolean `is_deleted` flag (timestamp gives you the "when" for free).
- **Position/ordering:** fractional index as `position double precision`; new-card position = `(prev_position + next_position) / 2`, or `prev_position + 1` / `next_position - 1` at a column boundary. A periodic rebalance is explicitly out of scope for v1 (documented as a known limitation, not silently unhandled).
- **Logging:** `console.error` in Server Actions is forwarded to Sentry via the SDK's automatic Next.js instrumentation; no separate logging library.
- **Commits:** Conventional-ish, matching the worker's required format `feat(F<NNN>): <summary> [assertions: AS-NN, AS-NN]`.
