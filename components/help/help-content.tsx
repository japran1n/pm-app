// Internal "how the dashboard works" documentation page (workers/PMs/admins,
// NOT the client portal -- that's the separate `how-we-work` route under
// `app/(portal)/...`). Deliberately a pure, static, presentational
// component with no props and no data fetch: every other page in this app
// renders live workspace data, but this one only ever needs to describe the
// *shape* of the product, so it can render identically for every workspace,
// every role, and every viewport -- and be covered by a plain render test
// the same way `HowWeWorkProcess` (portal's own static walkthrough) is.
//
// There are no real screenshots here (none were available while building
// this), so each section gets a small hand-drawn SVG "wireframe" instead --
// a schematic sketch of that screen's structure (columns of cards for the
// board, rows for a list, a chat rail + thread, etc.) rather than a literal
// photo. This keeps the page dependency-free (no image assets to ship or
// go stale) while still giving every section a genuine visual anchor next
// to its description, which is the actual ask ("vizuelno bogat prikaz").
import {
  KanbanSquare,
  ListChecks,
  FileText,
  MessageCircle,
  CalendarDays,
  Clock,
  Users,
  LayoutTemplate,
  ClipboardList,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Section = {
  id: string;
  title: string;
  icon: typeof KanbanSquare;
  summary: string;
  body: string;
  illustration: React.ReactNode;
};

// Small shared wireframe primitives -- kept intentionally simple (solid
// rects, no gradients/shadows beyond what Tailwind's own tokens give for
// free) so they read as "structural diagram" rather than a fake attempt at
// a pixel-accurate screenshot.
function WireBar({ className = "" }: { className?: string }) {
  return <div className={`rounded-sm bg-current/15 ${className}`} />;
}

function BoardWireframe() {
  const columns = [
    { label: "To do", cards: 3 },
    { label: "In progress", cards: 2 },
    { label: "Review", cards: 1 },
    { label: "Done", cards: 2 },
  ];
  return (
    <div
      data-testid="illustration-board"
      className="grid grid-cols-4 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      {columns.map((col) => (
        <div key={col.label} className="flex flex-col gap-1.5">
          <WireBar className="h-2 w-3/4" />
          {Array.from({ length: col.cards }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col gap-1 rounded-md border border-border bg-card p-1.5"
            >
              <WireBar className="h-1.5 w-full" />
              <WireBar className="h-1.5 w-1/2" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ListWireframe() {
  return (
    <div
      data-testid="illustration-list"
      className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-md border border-border bg-card p-1.5"
        >
          <div className="size-2.5 shrink-0 rounded-full bg-current/25" />
          <WireBar className="h-1.5 w-1/3" />
          <WireBar className="ml-auto h-1.5 w-8" />
          <WireBar className="h-1.5 w-10" />
        </div>
      ))}
    </div>
  );
}

function TaskDetailWireframe() {
  return (
    <div
      data-testid="illustration-task-detail"
      className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      <div className="col-span-2 flex flex-col gap-1.5">
        <WireBar className="h-2.5 w-2/3" />
        <WireBar className="h-1.5 w-full" />
        <WireBar className="h-1.5 w-full" />
        <WireBar className="h-1.5 w-3/4" />
        <div className="mt-1 flex flex-col gap-1 rounded-md border border-border bg-card p-1.5">
          <WireBar className="h-1.5 w-1/4" />
          <WireBar className="h-1.5 w-1/2" />
          <WireBar className="h-1.5 w-1/3" />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="rounded-md border border-border bg-card p-1.5">
          <WireBar className="h-1.5 w-1/2" />
        </div>
        <div className="rounded-md border border-border bg-card p-1.5">
          <WireBar className="h-1.5 w-1/2" />
        </div>
        <div className="rounded-md border border-border bg-card p-1.5">
          <WireBar className="h-1.5 w-2/3" />
        </div>
      </div>
    </div>
  );
}

function DocsWireframe() {
  return (
    <div
      data-testid="illustration-docs"
      className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      <div className="flex flex-col gap-1">
        <WireBar className="h-1.5 w-3/4" />
        <WireBar className="h-1.5 w-2/3" />
        <WireBar className="h-1.5 w-1/2" />
      </div>
      <div className="col-span-2 flex flex-col gap-1.5 rounded-md border border-border bg-card p-1.5">
        <WireBar className="h-2 w-1/2" />
        <WireBar className="h-1.5 w-full" />
        <WireBar className="h-1.5 w-full" />
        <WireBar className="h-1.5 w-2/3" />
      </div>
    </div>
  );
}

function ChatWireframe() {
  return (
    <div
      data-testid="illustration-chat"
      className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      <div className="flex flex-col gap-1">
        <WireBar className="h-1.5 w-2/3" />
        <WireBar className="h-1.5 w-1/2" />
        <WireBar className="h-1.5 w-3/4" />
      </div>
      <div className="col-span-2 flex flex-col justify-end gap-1.5">
        <div className="ml-auto w-2/3 rounded-md border border-border bg-card p-1.5">
          <WireBar className="h-1.5 w-full" />
        </div>
        <div className="w-1/2 rounded-md border border-border bg-card p-1.5">
          <WireBar className="h-1.5 w-full" />
        </div>
        <div className="ml-auto w-2/3 rounded-md border border-border bg-card p-1.5">
          <WireBar className="h-1.5 w-3/4" />
        </div>
      </div>
    </div>
  );
}

function CalendarWireframe() {
  return (
    <div
      data-testid="illustration-calendar"
      className="grid grid-cols-7 gap-1 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      {Array.from({ length: 21 }).map((_, i) => (
        <div
          key={i}
          className="flex aspect-square items-start justify-start rounded-sm border border-border bg-card p-0.5"
        >
          {[2, 5, 9, 13, 17].includes(i) && (
            <div className="size-1.5 rounded-full bg-current/40" />
          )}
        </div>
      ))}
    </div>
  );
}

function HoursWireframe() {
  const bars = [4, 7, 3, 8, 5, 2, 6];
  return (
    <div
      data-testid="illustration-hours"
      className="flex h-24 items-end gap-2 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      {bars.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm bg-current/25"
          style={{ height: `${h * 10}%` }}
        />
      ))}
    </div>
  );
}

function PortalWireframe() {
  return (
    <div
      data-testid="illustration-portal"
      className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-1.5">
        <WireBar className="h-1.5 w-1/2" />
        <WireBar className="h-1.5 w-3/4" />
        <WireBar className="h-1.5 w-2/3" />
      </div>
      <div className="flex flex-col gap-1.5 rounded-md border border-dashed border-border/70 p-1.5 opacity-60">
        <WireBar className="h-1.5 w-1/2" />
        <WireBar className="h-1.5 w-1/3" />
      </div>
    </div>
  );
}

function ViewsWireframe() {
  const tabs = ["Setup", "Design", "Dev", "QA", "+ Custom"];
  return (
    <div
      data-testid="illustration-views"
      className="flex flex-col gap-2 rounded-lg border border-border bg-muted/30 p-3 text-primary"
    >
      <div className="flex gap-1.5">
        {tabs.map((tab, i) => (
          <div
            key={tab}
            className={`rounded-md px-2 py-1 text-[9px] font-medium ${
              i === 1 ? "bg-current/20" : "border border-border bg-card"
            }`}
          >
            {tab}
          </div>
        ))}
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 rounded-md border border-border bg-card p-1.5"
          >
            <WireBar className="h-1.5 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  );
}

const SECTIONS: Section[] = [
  {
    id: "board-list",
    title: "Board & List view",
    icon: KanbanSquare,
    summary: "Two ways to look at the same tasks.",
    body: "Every project's tasks live in one underlying set — Board groups them into status columns you drag cards between, List lays them out as rows you can scan, sort, and bulk-edit. A toggle in the project header switches between the two instantly; filters, search, and the active view saved per project carry over either way, so switching views never loses your place.",
    illustration: <BoardWireframe />,
  },
  {
    id: "task-detail",
    title: "Task detail",
    icon: ClipboardList,
    summary: "Everything about one task, in a single panel.",
    body: "Clicking any task card or row opens its detail panel: a rich description, a subtask checklist that rolls up completion onto the parent, status and priority controls, assignees, due dates, attachments, and a full activity log of every change and comment. It's the same panel whether you open it from Board, List, My Tasks, or a chat mention — one source of truth per task.",
    illustration: <TaskDetailWireframe />,
  },
  {
    id: "my-tasks",
    title: "My Tasks",
    icon: ListChecks,
    summary: "Your personal, cross-project worklist.",
    body: "My Tasks pulls every task assigned to you across every project in the workspace into one list, so you never have to hop between projects to see what's on your plate today. It supports the same status/priority filtering and sorting as a project's List view, just scoped to \"assigned to me\" instead of one project.",
    illustration: <ListWireframe />,
  },
  {
    id: "docs",
    title: "Docs / Wiki",
    icon: FileText,
    summary: "Shared, structured knowledge — not scattered notes.",
    body: "Docs is the workspace's internal wiki: a tree of pages per project (or workspace-wide) for specs, runbooks, meeting notes, and anything else that shouldn't live only in someone's head or a chat thread. Pages support rich text and nesting, so a project's documentation grows into an organized hierarchy instead of one long scroll.",
    illustration: <DocsWireframe />,
  },
  {
    id: "chat",
    title: "Chat",
    icon: MessageCircle,
    summary: "Channels for teams, DMs for people.",
    body: "Chat covers both persistent project/topic channels the whole team can join and 1:1 direct messages. Messages support threads, reactions, and mentions that link straight back to tasks and docs, so a decision made in chat is never disconnected from the work it affects.",
    illustration: <ChatWireframe />,
  },
  {
    id: "calendar",
    title: "Calendar / Planner",
    icon: CalendarDays,
    summary: "Deadlines and schedules, at a glance.",
    body: "Calendar shows tasks with due dates plotted across a month/week grid, giving the whole team a shared view of what's landing when, without digging through individual project boards. It's read-driven from the same task data as Board/List, so a due date change anywhere shows up here automatically.",
    illustration: <CalendarWireframe />,
  },
  {
    id: "hours",
    title: "Hours tracking",
    icon: Clock,
    summary: "Time logged against real work.",
    body: "The Time section lets team members log hours against specific tasks or projects, then rolls those entries up into per-person and per-project totals — useful for understanding where effort actually went, capacity planning, and (for client-facing projects) transparent billing.",
    illustration: <HoursWireframe />,
  },
  {
    id: "portal",
    title: "Client portal",
    icon: Users,
    summary: "A separate, curated view for clients — not the internal dashboard.",
    body: "Clients never see this internal dashboard. They get their own portal scoped to just their project(s): scope, progress, files, approvals, and a request inbox — deliberately narrower than what the internal team sees, with no access to other clients' data, internal chat, or unrelated projects. \"Preview as client\" (in the sidebar, for owners/admins) lets you check exactly what a client currently sees before they do.",
    illustration: <PortalWireframe />,
  },
  {
    id: "views",
    title: "Views (Setup/Design/Dev/QA + custom)",
    icon: LayoutTemplate,
    summary: "Different lenses on the same project, tailored per team.",
    body: "Beyond the generic Board/List toggle, a project can define named views — Setup, Design, Dev, QA are common defaults matching how work actually flows through a team — each with its own saved filters and column/grouping setup. Teams can also create fully custom views for anything that doesn't fit the defaults, so every discipline gets a workspace tuned to how they actually work.",
    illustration: <ViewsWireframe />,
  },
];

export function HelpContent() {
  return (
    <div className="flex flex-col gap-8 p-6 sm:p-10" data-testid="help-page">
      <header
        className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-10"
        data-testid="help-hero"
      >
        <span className="text-tag font-medium uppercase tracking-wide text-muted-foreground">
          Internal guide
        </span>
        <h1 className="mt-2 title-2 font-semibold text-foreground sm:title-3">
          How this dashboard works
        </h1>
        <p className="mt-3 max-w-2xl text-mini text-muted-foreground sm:text-regular">
          A quick tour of every page and tab in the workspace — what it&rsquo;s
          for, how it fits together, and how it differs from what a client
          sees in the portal. Jump to any section below.
        </p>
      </header>

      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <nav
          aria-label="Documentation sections"
          data-testid="help-toc"
          className="flex shrink-0 flex-row flex-wrap gap-1 lg:sticky lg:top-6 lg:w-56 lg:flex-col lg:flex-nowrap"
        >
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className="rounded-lg px-2.5 py-2 text-mini font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {section.title}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Card key={section.id} id={section.id} data-testid={`help-section-${section.id}`}>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
                    <CardTitle>{section.title}</CardTitle>
                  </div>
                  <CardDescription>{section.summary}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <p className="text-mini text-muted-foreground">{section.body}</p>
                  {section.illustration}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
