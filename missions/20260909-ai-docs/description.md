# Mission: AI Docs Assistant (sidebar, docs-only)

## One-line goal
A right-docked AI assistant sidebar inside the workspace that reads, drafts and
edits **documents only** — never tasks, chat, time or any other entity.

## What it is
A persistent sidebar panel, opened from the workspace top bar, that always knows
which doc is currently open. It answers questions about docs, drafts new docs
from raw pasted material using doc templates, and proposes edits to existing docs
as an accept/reject diff. Nothing is ever written without an explicit human click.

## Why this scope
Documents are the safest possible first surface for AI in this app:
- Read tools cannot damage anything.
- The only write path is gated behind a diff the user accepts.
- The blast radius is one table (`docs`) plus `doc_folders`.
It also builds the **tool layer** that every later AI feature (tasks, bulk ops,
semantic search) will reuse without rework.

## Explicitly out of scope for this mission
- Any tool touching `tasks`, `messages`, `time_entries`, `approval_requests`.
- Bulk operations across many rows.
- Semantic / vector search (pgvector) — a later mission.
- Meeting transcription, calendar, Discord — separate missions.
- Autonomous writes of any kind.

## Provenance of requirements
This mission's requirements were established across an extended design
conversation with the user (session "AI and Discord Integrations", 2026-09-08/09),
which covered: scope narrowing to documents, the tool-gating model, two published
UI previews the user reviewed and approved, and the decision to model the sidebar
on Ship Studio's docked-agent placement (but on the Claude API with tool use,
NOT by spawning a CLI in a PTY — impossible in a web app).

Approved previews:
- Compose screen — https://claude.ai/code/artifact/a110a0a1-36bd-40be-8bcf-dbd681d45637
- Sidebar chat  — https://claude.ai/code/artifact/df130bf7-b323-4fd2-9588-5cc0c002cf95

User's approval to build, verbatim: "da svijda mi se ovaj feature, ajde pripremi
ceo plan za njega ... ti kreni da radis i implementias ovo ... radite bez mene i
mog feedbacka, potpuno autonomno".
