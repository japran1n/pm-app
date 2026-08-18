# Description

_Captured: 2026-08-18_ _Mission v2 — brownfield extension of mission 20260817-230717_

## What this mission is

The pm-app MVP (mission `20260817-230717`) shipped and is GREEN: workspaces,
projects, tasks with a 4-column Kanban board, list view, comments,
attachments, full-text search, dashboard charts, and time tracking. This
second mission takes that working MVP and closes the gap to a product people
would actually pick over Linear/Jira for a small team.

The scope was chosen by the user from a 54-item improvement analysis. Six
areas were selected, two were explicitly rejected.

## In scope (40 improvement items)

**Task model v2** — subtasks + checklists with completion %, task-to-task
dependencies (blocks / blocked by), multiple assignees + watchers, estimates
compared against logged time, recurring tasks, bulk actions on multi-selected
tasks, task duplication and reusable task templates, human-readable task keys
(`PM-142`), rich-text descriptions, and a trash/undo path for deleted tasks
and comments.

**Collaboration** — @mentions in comments, an in-app notification center,
email notifications plus a daily digest, a per-task activity log, comment
editing and reactions.

**Views** — a cross-project "My tasks" screen, a calendar view by due date, a
timeline/Gantt view, board grouping and swimlanes, saved/shared views, and
team-definable board columns (custom statuses replacing the fixed four).

**UI/UX** — a Cmd+K command palette, app-wide keyboard shortcuts, shareable
task URLs, a dark-mode toggle, quick-add on the board, full inline editing in
the list view, user avatars and per-user colors, reworked empty states plus a
first-run tour, consistent skeletons and optimistic UI, drag-and-drop file
upload with image previews, a project list with favourites in the sidebar, a
board that genuinely works on mobile, and header search with autocomplete.

**Team & administration** — user profiles (display name, avatar, timezone),
finer-grained roles (viewer / guest) and per-project access, guest access
scoped to a single project, a workspace audit log, a real workspace settings
page, and a browsable project archive with restore.

## Explicitly out of scope (user decision)

- **Reporting/analytics** — burndown, velocity, workload-per-person, cycle
  time, CSV/Excel export, sprints/milestones. Rejected for this mission.
- **Platform/infra hardening** — pagination/virtualisation, rate limiting,
  Sentry/error boundaries, offline-reconnect handling, seed scripts, wider
  test suite, PWA/push, public REST API and webhooks. Rejected for this
  mission.
- **Slack/Discord webhook integration** — rejected (email + in-app
  notifications only).

## Constraints carried over from mission 1

Next.js 16 App Router (`proxy.ts`, async `params`/`cookies`), Supabase
(Postgres + Auth + Storage + Realtime) with RLS as the authorization
boundary, shadcn/ui on Tailwind v4 with Base UI primitives, Server Actions
returning a discriminated-union result, soft delete via `deleted_at`,
fractional-index ordering. No separate backend. Every new table gets RLS
joined through `workspace_members` on the same pattern as `tasks`/`comments`.

## The one new external service

Email notifications (item 13) require a transactional email provider. Supabase
Auth's built-in mailer covers magic links only. This mission adds Resend; the
connect phase needs a `RESEND_API_KEY` and a verified sender domain from the
user.
