"use client";

// F011: quiet, collapsible cards that let the user audit what the
// assistant's tool calls did, without competing with the assistant's own
// text (see this feature's spec header comment — "it exists so the user
// *can* audit, not so they must").
//
// Data shape: lib/ai/use-doc-assistant.ts's `ToolCallView` (already
// merged by tool_use id across tool_start/tool_end — this component does
// no merging of its own). Per the route's own protocol comment
// (app/api/ai/docs/route.ts), a failed tool_end always carries the
// literal `summary: "tool error"`; there is no separate boolean/status
// field for failure, so that literal is this component's ONLY signal for
// the error branch (see Autonomous decisions in the handoff for why this
// is safe rather than fragile — `summarizeToolResult` never legitimately
// returns that exact string for a successful call).
//
// `detail` is server-sanitised before it ever reaches this hook (F026
// stops raw thrown-error text; F032 bounds the one model-controlled
// string that can reach `detail`) — it is rendered as plain text only,
// never as HTML or markdown, per the spec's explicit instruction.
//
// No raw "arguments" ever cross the wire: `tool_start` only carries
// `{id, name}` (see use-doc-assistant.ts's own event-envelope comment and
// route.ts's `send({ t: "tool_start", id, name })` call site) — the model
// input is never sent to the client. The expanded panel therefore shows
// the result detail only; there is no arguments payload to render. This
// is a data-availability constraint, not a scope decision by this
// feature — see the handoff for the suggested follow-up if the protocol
// should start including a sanitised argument summary.

import { AlertTriangle, Check, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ToolCallView } from "@/lib/ai/use-doc-assistant";

/** The route's literal, stable marker for a failed tool call (see file header). */
const ERROR_SUMMARY = "tool error";

function isFailed(toolCall: ToolCallView): boolean {
  return toolCall.status === "done" && toolCall.summary === ERROR_SUMMARY;
}

function ResultGlyph({ toolCall }: { toolCall: ToolCallView }) {
  if (toolCall.status === "running") {
    return (
      <Loader2
        className="size-3.5 shrink-0 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
    );
  }
  if (isFailed(toolCall)) {
    return (
      <AlertTriangle
        className="size-3.5 shrink-0 text-status-waiting"
        aria-hidden="true"
      />
    );
  }
  return (
    <Check
      className="size-3.5 shrink-0 text-status-done"
      aria-hidden="true"
    />
  );
}

function oneLineSummary(toolCall: ToolCallView): string {
  if (toolCall.status === "running") return "Running…";
  return toolCall.summary || "Done";
}

/**
 * A single tool call, collapsed by default. Uses `components/ui/
 * collapsible.tsx` (a `@base-ui/react` `Collapsible` wrapper already used
 * elsewhere in this codebase) rather than a hand-rolled div+onClick, so
 * the trigger is a real, keyboard-operable button with a visible focus
 * ring out of the box (AS-069).
 */
export function ToolCallCard({ toolCall }: { toolCall: ToolCallView }) {
  const failed = isFailed(toolCall);
  const hasDetail = Boolean(toolCall.detail);

  return (
    <Collapsible
      data-testid="tool-call-card"
      data-status={toolCall.status}
      data-failed={failed ? "true" : "false"}
    >
      <CollapsibleTrigger
        disabled={!hasDetail}
        data-testid="tool-call-card-trigger"
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
          "text-mini text-muted-foreground",
          hasDetail && "cursor-pointer hover:bg-muted",
          !hasDetail && "cursor-default",
          // Visible focus state (AS-069) — same ring treatment
          // components/ui/button.tsx uses elsewhere in this codebase.
          "outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:border-ring",
        )}
      >
        <ResultGlyph toolCall={toolCall} />
        <span className="shrink-0 truncate font-mono text-micro text-foreground">
          {toolCall.name || "tool"}
        </span>
        <span className="min-w-0 flex-1 truncate">
          {oneLineSummary(toolCall)}
        </span>
      </CollapsibleTrigger>
      {hasDetail && (
        <CollapsibleContent
          data-testid="tool-call-card-detail"
          className={cn(
            "px-2 pb-2 pt-1 text-micro whitespace-pre-wrap break-words",
            failed ? "text-status-waiting" : "text-muted-foreground",
          )}
        >
          {toolCall.detail}
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

/**
 * Renders every tool call for the current turn, quiet by default:
 * internal rows are separated by `--line-row` (never `border-border`,
 * per the two-family rule this codebase's F009 handoff documents), and
 * the whole list sits with no border/shadow of its own so it never reads
 * as a second panel competing with the thread above it.
 *
 * Renders nothing when there are no tool calls yet — an empty region is
 * quieter than an empty bordered box.
 */
export function ToolCallList({ toolCalls }: { toolCalls: ToolCallView[] }) {
  if (toolCalls.length === 0) return null;

  return (
    <div
      data-testid="tool-call-list"
      className="flex flex-col divide-y divide-line-row rounded-md border border-line-row"
    >
      {toolCalls.map((toolCall) => (
        <ToolCallCard key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  );
}
