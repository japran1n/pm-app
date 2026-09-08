// Redesign of the static "How we work" page (this route was split out of
// `site/page.tsx` by F114/A3 -- see how-we-work-list.tsx's own header
// comment). That worker shipped only the existing guides list on the new
// route; this pass adds the marketing/storytelling half the page was
// always meant to carry: a full, non-task-linked walkthrough of the
// agency's own macro-process, told once, the same way for every project,
// independent of this particular project's live phase/task state (that
// live view already exists, bigger and interactive, as "Where we are" --
// `components/portal/phase-timeline.tsx` -- on the Overview page; this is
// deliberately its opposite: static, narrative, no data fetch).
//
// Content below is the Good Guys process (Setup -> Discovery & Technical
// Audit -> Architecture -> Design -> Development -> QA -> Launch ->
// Handover) rewritten in client-facing language -- no ClickUp/task/ticket
// vocabulary, one short "what happens" line and one short "why it matters
// to you" line per phase, per this feature's own instruction.
import type { LucideIcon } from "lucide-react";
import {
  ClipboardList,
  Compass,
  Blocks,
  Palette,
  Code2,
  ShieldCheck,
  Rocket,
  Handshake,
} from "lucide-react";

type MacroPhase = {
  id: string;
  title: string;
  what: string;
  why: string;
  icon: LucideIcon;
};

const MACRO_PHASES: MacroPhase[] = [
  {
    id: "setup",
    title: "Setup",
    what: "We kick off with a shared workspace, a single source of truth for files and decisions, and a clear point of contact on both sides.",
    why: "Nothing gets lost between emails and chat threads -- you always know where to look and who to ask.",
    icon: ClipboardList,
  },
  {
    id: "discovery",
    title: "Discovery & technical audit",
    what: "We dig into your goals, your audience, and (if one exists) your current site or product, so we understand what's working and what isn't before we design anything.",
    why: "You get a plan grounded in your actual business, not a generic template stretched to fit.",
    icon: Compass,
  },
  {
    id: "architecture",
    title: "Architecture",
    what: "We map out how the product is structured -- the pages, the data, the systems it needs to talk to -- and agree on that shape with you before building starts.",
    why: "Big structural changes are cheap on paper and expensive in code; this is where we catch them early.",
    icon: Blocks,
  },
  {
    id: "design",
    title: "Design",
    what: "From research and sitemap through moodboards, style direction, full UI design, and handoff-ready documentation, each step builds on the one before it -- and you see and sign off on each one.",
    why: "You're never surprised by the final look -- you helped choose the direction several steps earlier.",
    icon: Palette,
  },
  {
    id: "development",
    title: "Development",
    what: "We build the foundation, the content system, the components, and the pages, then layer in animation, forms, and your real content.",
    why: "The product is assembled in the same order it was designed, so what ships matches what you approved.",
    icon: Code2,
  },
  {
    id: "qa",
    title: "Quality assurance",
    what: "Every page goes through a technical review (does it work, everywhere) and a design review (does it look right, everywhere) before it's called done.",
    why: "Bugs and visual slips get caught by us, not by your customers.",
    icon: ShieldCheck,
  },
  {
    id: "launch",
    title: "Launch",
    what: "We move the finished product live, following a checklist built specifically for your setup, and watch it closely in the first hours after launch.",
    why: "Go-live is planned and boring on purpose -- boring is what you want on launch day.",
    icon: Rocket,
  },
  {
    id: "handover",
    title: "Handover",
    what: "You get full ownership: access, documentation, and a walkthrough of how to run and maintain what we built.",
    why: "You're never locked into needing us for basic changes -- the keys are genuinely yours.",
    icon: Handshake,
  },
];

const ACCENT_CLASSES = [
  "bg-status-progress-bg text-status-progress",
  "bg-accent text-accent-foreground",
  "bg-status-done-bg text-status-done",
  "bg-status-blocked-bg text-status-blocked",
];

// F-redo (client feedback, second pass): the first version stacked every
// step in a vertical list (alternating left/right cards, but still one
// beneath the next). The client's own reference was "Where we are"
// (`phase-timeline.tsx`) -- a HORIZONTAL axis with phases laid out left to
// right along one line -- "just here bigger and end to end." This rebuild
// keeps every existing content field (icon, title, what, why) and test
// hook, but lays the eight steps out along a single horizontal flow
// instead: one connecting line running left to right behind every node,
// each phase its own column (icon node on the line, title, then its two
// text lines underneath), the whole row scrolling horizontally rather than
// wrapping into a second visual row -- the same shape as a roadmap/Gantt
// flow, matching what "Where we are" already does with dated bars, but
// static/narrative instead of data-driven.
const NODE_COLUMN_WIDTH_PX = 208;

export function HowWeWorkProcess() {
  return (
    <section
      data-testid="how-we-work-process"
      aria-label="Our process, from setup to handover"
      className="flex flex-col gap-2"
    >
      {/* Horizontal scroller: on a wide screen the eight columns below may
          exceed the viewport, and on a phone they always will -- rather
          than collapsing back into a vertical stack (the exact shape the
          client rejected), this scrolls sideways, the same tradeoff any
          Gantt/roadmap chart makes. `snap-x` lets a touch swipe land on
          one phase at a time instead of stopping mid-column. */}
      <ol
        data-testid="how-we-work-process-track"
        className="relative flex snap-x snap-mandatory gap-0 overflow-x-auto pb-4 pt-8"
      >
        {/* The connecting spine: one continuous horizontal line running
            through every node's own centre, the "full cycle, start to
            finish, along one axis" visual the client asked for -- the
            direct horizontal counterpart of `phase-timeline.tsx`'s vertical
            stack-of-rows-on-a-shared-axis idea. Positioned at the node
            circle's vertical centre (see the `top` below, matching half of
            the sm:size-16 / 64px circle plus its container's own top
            offset) and drawn once, behind every node, rather than as N
            separate connector segments that could drift out of alignment
            with each other. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0 top-14 hidden h-px bg-border sm:top-16 sm:block"
          style={{ minWidth: MACRO_PHASES.length * NODE_COLUMN_WIDTH_PX }}
        />

        {MACRO_PHASES.map((phase, index) => {
          const Icon = phase.icon;
          const accent = ACCENT_CLASSES[index % ACCENT_CLASSES.length];
          const isLast = index === MACRO_PHASES.length - 1;

          return (
            <li
              key={phase.id}
              data-testid="how-we-work-process-step"
              className="relative flex shrink-0 snap-start flex-col items-center gap-4 px-3 text-center"
              style={{ width: NODE_COLUMN_WIDTH_PX }}
            >
              {/* The node itself: sits directly on the connecting spine,
                  same colour language as the old vertical version (per-
                  phase accent + numbered badge), just centred in its own
                  column instead of offset to one side of a card. */}
              <div
                className={`relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full ring-4 ring-background sm:size-16 ${accent}`}
              >
                <Icon className="size-5 sm:size-7" aria-hidden="true" />
                <span
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background sm:-top-2 sm:-right-2 sm:size-6 sm:text-micro"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              </div>

              {/* Directional arrowhead between this node and the next,
                  drawn only between nodes (never after the last one) --
                  the "flowchart", not just "a line", cue the client's
                  reference had. Hidden below `sm` along with the spine
                  itself, where the column stacks under its own node
                  instead of sitting beside the next one. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-14 right-0 z-10 hidden -translate-y-1/2 translate-x-1/2 text-border sm:top-16 sm:block"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M1 1L9 6L1 11"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}

              <div className="flex flex-col gap-1.5">
                <h3 className="text-mini font-semibold text-foreground sm:text-regular">
                  {phase.title}
                </h3>
                <p className="text-micro text-foreground/90 sm:text-mini">{phase.what}</p>
                <p className="text-micro italic text-muted-foreground sm:text-mini">{phase.why}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
