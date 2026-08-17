# Description

_Captured: 2026-08-17T21:07:17Z_

A collaborative Project Management dashboard (Jira/Linear-style), rebuilt from
a reference implementation (ed-roh/project-management: Next.js + Express +
Prisma + Postgres + AWS Cognito/Amplify) as a modern MVP on Next.js + Supabase
+ shadcn/ui.

Core domain: organizations/workspaces contain projects; projects contain
tasks; tasks have status, priority, assignee, due date, comments, and
attachments; users belong to teams. Views needed: Kanban board (drag & drop),
list/table view, and a home dashboard with charts (tasks by status/priority).
Timeline/Gantt is out of scope for v1 (explicitly deferred from the reference
app's feature set as low MVP value).

Known weaknesses in the reference app to correct in this rebuild: no DB-level
enums for status/priority (plain strings), no ordering/position field for
Kanban drag-and-drop (board only changes column, not order within column), no
multi-tenancy (no organization/workspace concept), no auth verification on
the backend (tokens sent but never verified), no created/updated timestamps,
duplicated assignment modeling (assignedUserId column AND a separate
TaskAssignment join table used inconsistently).

Constraints from the user: must use Next.js, Supabase (Postgres + Auth +
Storage, and Realtime if it fits), and shadcn/ui. No separate Express
backend — Supabase replaces the custom API server. This is a solo
vibe-coded MVP, not an enterprise system: prioritize a solid, correct
foundation over breadth of features.
