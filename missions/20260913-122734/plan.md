# Plan

_Mission: 20260913-122734 — Client-facing handover documents_
_Status: DRAFT — awaiting approval_

## M1 — Foundation

| # | Feature | Time | Assertions |
|---|---|---|---|
| F001 | Install markdown and sanitization dependencies | 15 min | AS-001, AS-007 (prereq) |

## M2 — Rendering

| # | Feature | Time | Assertions |
|---|---|---|---|
| F002 | Markdown renderer component | 30 min | AS-001–008, AS-061 |
| F003 | YouTube URL detection utility | 15 min | AS-009–011, AS-063 |
| F004 | YouTube iframe component | 30 min | AS-009–015, AS-068 |
| F005 | Wire renderer into how-we-work list | 20 min | AS-001–006, AS-008, AS-015–017, AS-069 |
| F006 | Tests — markdown renderer and YouTube detection | 30 min | AS-063, AS-065 |

## M3 — Templates DB

| # | Feature | Time | Assertions |
|---|---|---|---|
| F007 | Migration — doc_templates table | 20 min | AS-018 |
| F008 | Migration — doc_template_links table | 15 min | AS-019 |
| F009 | RLS policies — doc_templates and doc_template_links | 25 min | AS-020–023 |
| F010 | Regenerate TypeScript database types | 10 min | (enabler) |

## M4 — Templates UI

| # | Feature | Time | Assertions |
|---|---|---|---|
| F011 | Query layer — getDocTemplates etc. | 20 min | AS-020, AS-024 |
| F012 | Server actions — create, rename, delete template; add/remove link | 35 min | AS-021–022, AS-025–030 |
| F013 | "Docs" tab in /templates route | 25 min | AS-024–028 |
| F014 | Create doc template form | 25 min | AS-021, AS-025, AS-062 |
| F015 | Template link editor | 30 min | AS-029–030, AS-037 |
| F016 | Server action — createDocFromTemplate | 30 min | AS-031–035 |
| F017 | "New from template" button in docs sidebar | 25 min | AS-031–033 |
| F018 | Tests — seed-from-template and delete guard | 30 min | AS-066–067 |
| F019 | Data migration — seed Webflow template into goodguys-demo | 25 min | AS-036–038 |

## M5 — Placeholders DB

| # | Feature | Time | Assertions |
|---|---|---|---|
| F020 | Migration — doc_placeholder_values table + RLS | 25 min | AS-039–043 |
| F021 | Placeholder resolution utility | 35 min | AS-044–056, AS-064 |

## M6 — Placeholders UI

| # | Feature | Time | Assertions |
|---|---|---|---|
| F022 | Project settings — placeholder values form | 30 min | AS-057–060 |
| F023 | Portal — resolve and strip placeholders in client view | 25 min | AS-049, AS-055–056 |
| F024 | Team side — highlight unresolved placeholders | 25 min | AS-054–055 |
| F025 | Tests — placeholder resolution | 20 min | AS-064 |

## M7 — Polish & QA

| # | Feature | Time | Assertions |
|---|---|---|---|
| F026 | Accessibility and performance pass | 20 min | AS-013–014, AS-068–069 |

