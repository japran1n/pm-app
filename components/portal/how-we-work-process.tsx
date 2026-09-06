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

export function HowWeWorkProcess() {
  return (
    <section
      data-testid="how-we-work-process"
      aria-label="Our process, from setup to handover"
      className="flex flex-col gap-2"
    >
      <ol className="relative flex flex-col gap-8 sm:gap-10">
        {/* A single connecting spine behind every step, running the full
            height of the list -- this is the "full cycle, start to finish"
            visual the redesign asked for, deliberately bigger and more
            illustrative than the compact bar-chart "Where we are" timeline
            (which is task-progress-driven and lives on Overview). */}
        <div
          aria-hidden="true"
          className="absolute left-6 top-6 bottom-6 hidden w-px bg-border sm:left-8 sm:block"
        />
        {MACRO_PHASES.map((phase, index) => {
          const Icon = phase.icon;
          const accent = ACCENT_CLASSES[index % ACCENT_CLASSES.length];
          const alignEnd = index % 2 === 1;
          return (
            <li
              key={phase.id}
              data-testid="how-we-work-process-step"
              className={`relative flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6 ${
                alignEnd ? "sm:flex-row-reverse sm:text-right" : ""
              }`}
            >
              <div
                className={`relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full ring-4 ring-background sm:size-16 ${accent}`}
              >
                <Icon className="size-5 sm:size-7" aria-hidden="true" />
                <span
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background sm:-top-2 sm:-right-2 sm:size-6 sm:text-xs"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
              </div>

              <div
                className={`flex-1 rounded-lg border border-border bg-card p-5 shadow-sm sm:p-6 ${
                  alignEnd ? "sm:mr-2" : "sm:ml-2"
                }`}
              >
                <h3 className="text-base font-semibold text-foreground sm:text-lg">
                  {phase.title}
                </h3>
                <p className="mt-2 text-sm text-foreground/90">{phase.what}</p>
                <p className="mt-2 text-sm italic text-muted-foreground">{phase.why}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
