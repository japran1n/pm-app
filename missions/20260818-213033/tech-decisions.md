# Tech decisions

_Mission: 20260818-213033 (v2)_ _Written: 2026-08-18_

This mission extends an existing, working codebase. The stack from mission
`20260817-230717` is unchanged and is not re-litigated here — see that
mission's `tech-decisions.md` for Next.js 16 / Supabase / shadcn decisions
that still bind every worker (async `params`, `proxy.ts`, new Supabase key
format, discriminated-union Server Action results, `deleted_at` soft delete,
fractional-index ordering, RLS through `workspace_members`).

## Stack

Unchanged: TypeScript 5, Next.js 16.3.x App Router (Turbopack), React 19.2,
Supabase Postgres + Auth + Storage + Realtime, Tailwind v4 + shadcn/ui on
Base UI primitives, Vercel.

New capability surfaces added by this mission:

- Rich text: Tiptap 3.x (ProseMirror-based, headless) <!-- verified against https://www.npmjs.com/package/@tiptap/react as of 2026-08-18 — latest published @tiptap/react is 3.30.1 -->
- Command palette: `cmdk` via shadcn's Command component, which is primitive-layer independent and works with the Base UI build already installed <!-- verified against https://ui.shadcn.com/docs/components/radix/command and https://shadcnstudio.com/docs/components/command as of 2026-08-18 -->
- Transactional email: Resend + React Email <!-- verified against https://www.npmjs.com/package/resend as of 2026-08-18 — latest published `resend` is 6.20.0 -->
- Scheduling (recurring tasks, daily digest, overdue sweep): Supabase Cron (pg_cron, enabled by default on all plans) calling a Postgres function directly, with `pg_net` only where an HTTP call to a Next.js route is unavoidable <!-- verified against https://supabase.com/docs/guides/cron and https://supabase.com/docs/guides/functions/schedule-functions as of 2026-08-18 -->

## Libraries used

- `@tiptap/react` ^3.30, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-mention`, `@tiptap/extension-link`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item` <!-- verified against https://www.npmjs.com/package/@tiptap/react as of 2026-08-18 --> — rich-text descriptions and comments (AS-306–AS-313) and the `@` mention picker (AS-371–AS-378). Headless, so it inherits the existing Tailwind/shadcn styling rather than importing a second design system.
- `cmdk` (current major at install time) <!-- verified against https://ui.shadcn.com/docs/components/radix/command as of 2026-08-18 --> — Cmd+K palette (AS-459–AS-466). Added through `npx shadcn@latest add command`, so it lands as an editable component in `components/ui/` like every other primitive here.
- `resend` ^6.20 + `@react-email/components` <!-- verified against https://www.npmjs.com/package/resend as of 2026-08-18 --> — notification emails and the daily digest (AS-393–AS-402). Chosen over raw SMTP because email templates are authored as React components, matching the rest of the codebase.
- `date-fns` (already installed) — all calendar, timeline, recurrence, and timezone maths. No new date library.
- `@dnd-kit/core` + `@dnd-kit/sortable` (already installed) — reused for calendar drag-to-reschedule (AS-445) and timeline bar dragging (AS-454); no second drag library.
- `recharts` (already installed) — unchanged; the dashboard status chart only needs to read custom statuses (AS-412).
- `next-themes` (already installed, currently unused in the UI) — powers the theme toggle (AS-211–AS-213).
- `zod` (already installed) — every new Server Action gets a schema, no exceptions.
- `sonner` (already installed) — the undo affordance after delete (AS-345) is a toast action, not a new component family.

## Libraries explicitly avoided

- `react-big-calendar` / `fullcalendar` — the calendar view is a month grid over tasks that already have due dates; a 200KB calendar framework with its own event model and CSS would fight Tailwind and duplicate `date-fns`. Built as a plain CSS grid instead.
- `gantt-task-react` / `frappe-gantt` — rejected in mission 1 and still rejected. The timeline is bars positioned on a date scale; the libraries bring their own canvas/SVG rendering, styling, and interaction models that would not match the board's `@dnd-kit` behaviour.
- `react-window` / `@tanstack/react-virtual` — virtualisation is in the explicitly out-of-scope infra bucket for this mission.
- `slate` / `lexical` / `quill` — alternatives to Tiptap. Tiptap wins on the ready-made mention, link, and task-list extensions this mission needs, and on ProseMirror's paste-sanitisation behaviour (AS-308, AS-309).
- `nodemailer` / raw SMTP — Resend covers sending, templating, and delivery logs without running an SMTP relay.
- `node-cron` / Vercel Cron — the database already has pg_cron enabled and the jobs are database-shaped (generate occurrences, sweep overdue). Keeping the scheduler next to the data avoids a second deployment target holding a service key.
- Slack/Discord SDKs — the user explicitly cut webhook integrations from this mission.
- A permissions library (CASL, Oso) — the role model is four workspace roles plus a project membership table; a hand-written `lib/auth/permissions.ts` predicate module (AS-230) is smaller than the library's config would be.

## File layout (additions to the existing tree)

```
app/(workspace)/w/[workspaceSlug]/
├── my-tasks/page.tsx                        # AS-435..441
├── calendar/page.tsx                        # AS-442..450
├── timeline/page.tsx                        # AS-451..458
├── trash/page.tsx                           # AS-343..352
├── archive/page.tsx                         # AS-250..256
├── templates/page.tsx                       # AS-328..333
├── notifications/page.tsx                   # AS-385..392 (panel has its own component)
├── settings/
│   ├── page.tsx                             # workspace settings AS-239..244
│   ├── profile/page.tsx                     # AS-201..210
│   └── audit/page.tsx                       # AS-245..249
└── projects/[projectId]/
    ├── tasks/[taskKey]/page.tsx             # deep-linked task AS-473..478
    └── settings/columns/page.tsx            # custom statuses AS-403..417
components/
├── editor/          (tiptap editor, mention extension, renderer)
├── command/         (command palette, shortcut provider, shortcut help)
├── notifications/   (bell, panel, item, preferences)
├── calendar/        (month grid, day cell, overflow popover)
├── timeline/        (scale, bars, dependency connectors)
├── task/            (subtasks, checklist, dependencies, watchers, activity, bulk bar)
└── views/           (saved views, grouping controls, swimlanes)
lib/
├── auth/permissions.ts                      # single source of truth, AS-230
├── notifications/                           # create + fan-out helpers
├── email/                                   # Resend client + React Email templates
├── recurrence/                              # rule parsing + next-occurrence maths
└── activity/                                # activity writer
supabase/migrations/                          # ~20 new migrations, all with RLS
```

## External services needed

- **Supabase** — already connected; MCP already registered in `.mcp.json` from mission 1. Workers use it for migrations and RLS as before. New: `pg_cron` and `pg_net` extensions must be enabled (orchestrator/worker task, not a user task).
- **Resend** — NEW. No official MCP found as of 2026-08-18; integrated via the `resend` npm SDK. Needs from the user: a `RESEND_API_KEY` and a verified sender domain or the Resend test sender. This is the only credential this mission asks for.
- **Playwright** — already registered; used by the ux-validator for the new views.
- **Vercel / GitHub** — unchanged, no new credentials.

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

## Conventions (additions to mission 1's, which all still apply)

- **Every new table** gets RLS in the same migration that creates it, joined through `workspace_members` (or through `project_members` where project-level scoping applies), plus an integration test proving a non-member reads zero rows.
- **Permissions:** no component and no Server Action hand-rolls a role check. Both call `lib/auth/permissions.ts`. UI gating and server enforcement must be derived from the same predicate (AS-230, AS-231).
- **Migrations are additive.** Columns being replaced (`tasks.assignee_id`, `tasks.status`) are backfilled into their new home and left in place, deprecated, until the milestone that removes them lands green. No destructive migration ships in the same feature as the code that depends on it.
- **Notifications are written server-side only,** by `lib/notifications/`, never by a client. Every notification insert names its actor, and the fan-out helper filters the actor out of its own recipient list (AS-384).
- **Email never blocks a mutation.** Send failures are caught, logged, and retried out of band; the user-facing action still returns `{ ok: true }` (AS-401).
- **Rich text is stored as JSON** (Tiptap document), with the plain-text projection kept in a separate column for full-text search. Rendering is done through the sanitising renderer, never `dangerouslySetInnerHTML` on raw input (AS-309).
- **Timezone:** all date bucketing that a user sees (overdue, today, calendar cells, digest timing) is computed in the user's profile timezone, not the server's (AS-207, AS-450, AS-400).
- **Realtime:** any table whose changes must appear live (notifications, comment reactions, board columns) is added to the Realtime publication in its own migration, and its RLS is checked against the mission-1 gotcha where an UPDATE-ed row must still satisfy its own SELECT policy to be delivered.
- **Commits:** unchanged — `feat(F<NNN>): <summary> [assertions: AS-NNN, AS-NNN]`.


## QA feedback extension (added 2026-08-19, M19)

### What was researched

- **ClickUp's own Chrome extension** does screenshot capture (full view or selected area), markup with arrows, shapes, blur and numbered annotations, and attaches the result to a task. <!-- verified against https://help.clickup.com/hc/en-us/articles/6305599755671-Use-the-Chrome-extension as of 2026-08-19 -->
- **The specialist tools in this category** (Marker.io, BugHerd, Usersnap) go further, and the gap is the part that actually saves developer time: every report carries the page URL, browser and OS, screen resolution, **console logs**, and failed network requests, captured at the moment of the report. <!-- verified against https://marker.io/blog/console-logs and https://marker.io/bug-tracker as of 2026-08-19 --> A screenshot alone produces "it's broken on my machine"; the metadata is what makes a report reproducible.
- **Manifest V2 is removed from the Chrome Web Store on 31 August 2026**, so this is MV3-only, no migration path to consider. <!-- verified via Chrome for Developers / Manifest V3 migration docs as of 2026-08-19 -->
- **`chrome.tabs.captureVisibleTab`** requires `activeTab` or `<all_urls>`. `activeTab` is granted by a user gesture on the extension action, which is exactly our flow — so we can avoid `<all_urls>` entirely. Note a documented quirk: the grant works from the action popup but is unreliable from a side panel, so the capture must be triggered from the popup. <!-- verified against https://developer.chrome.com/docs/extensions/reference/api/tabs and chromium-extensions group threads as of 2026-08-19 -->
- **Supabase auth in MV3** has one real trap: a service worker has no `window`, no `localStorage`, and goes idle after ~30s, so the default session storage does not work. The supported pattern is a custom storage adapter over `chrome.storage.local` passed to `createClient` via `auth.storage`, plus an explicit refresh when the popup opens. <!-- verified against multiple current write-ups incl. https://pustelto.com/blog/supabase-auth/ and https://gourav.io/blog/supabase-auth-chrome-extension as of 2026-08-19 -->
- **Distribution**: a one-time US$5 developer registration fee per account, review typically days but sometimes weeks, and submissions were running slow as of April 2026. Unlisted distribution is available for internal team use without a public listing. <!-- verified against https://developer.chrome.com/docs/webstore/review-process and current fee write-ups as of 2026-08-19 -->

### Decisions

- **Chrome MV3 extension first, embeddable widget later.** The specialists ship both: an extension for internal QA on any site, and a JS widget the client installs so external reviewers need install nothing. The user asked for the extension; the capture and report pipeline is therefore built as a shared module so a widget can reuse it without a rewrite.
- **Popup, not side panel**, because `activeTab` capture is reliable from the popup and documented as flaky from the side panel.
- **`activeTab` only — no `<all_urls>`.** It is granted per user gesture, which matches "click the icon, then capture", and it keeps the store review and the privacy story simple.
- **Auth by session handoff from the web app**, not a second sign-in inside the extension: the user is already signed in to pm-app, so a short-lived handoff page passes the session to the extension, which stores it through a `chrome.storage.local` adapter. Only the `sb_publishable_*` key is ever shipped in the bundle.
- **Task creation goes through one narrow authenticated Route Handler**, not a general public API (which the user cut from this mission). It accepts the reporter's Supabase JWT, re-verifies membership server-side, and creates the task through the same code path the web app uses.
- **The screenshot uploads to the existing attachments bucket with the user's own JWT**, so the existing RLS is the enforcement boundary and no service key leaves the server.
- **Console capture is a content script hooking `console` and `window.onerror` into a bounded ring buffer.** It can only see what happens after injection — this is a real limitation of every tool in this category and must be stated in the UI rather than implied away.

### New external dependency

- Chrome Web Store developer account (one-time US$5, user action — the orchestrator cannot register or pay). Not needed to build or test: an unpacked extension loads locally, and Playwright can drive it.
