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
// `detail` and `args` are both server-sanitised before they ever reach
// this hook (F026 stops raw thrown-error text; F032 bounds the one
// model-controlled string that used to reach `detail`; F033 extends the
// same bounded-length/sanitised treatment to a real per-tool success
// `detail` and to `tool_start`'s `args`, via lib/ai/tool-result-display.ts)
// — both are rendered as plain text only, never as HTML or markdown, per
// the spec's explicit instruction.
//
// F033 (fixes M2-SCRUTINY.md B1 / AS-063): the success path used to send
// no `detail` at all (`summarizeToolResult` returned the bare literal
// "ok"), which made `hasDetail` false and disabled the card's trigger
// entirely — an inert, unclickable row. The route now sends a real,
// bounded `detail` (and `args`) on success too, so `hasContent` below
// reflects whether there is anything to show, not just whether the tool
// failed.

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
  // F033: expandable whenever there is EITHER a result detail OR an
  // argument summary to show — not `detail` alone, so a tool call whose
  // result has no interesting detail but does have arguments (or vice
  // versa) still expands.
  const hasContent = Boolean(toolCall.detail) || Boolean(toolCall.args);

  return (
    <Collapsible
      data-testid="tool-call-card"
      data-status={toolCall.status}
      data-failed={failed ? "true" : "false"}
    >
      <CollapsibleTrigger
        disabled={!hasContent}
        data-testid="tool-call-card-trigger"
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left",
          "text-mini text-muted-foreground",
          hasContent && "cursor-pointer hover:bg-muted",
          !hasContent && "cursor-default",
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
      {hasContent && (
        <CollapsibleContent
          data-testid="tool-call-card-detail"
          className={cn(
            "px-2 pb-2 pt-1 text-micro whitespace-pre-wrap break-words",
            failed ? "text-status-waiting" : "text-muted-foreground",
          )}
        >
          {toolCall.args && (
            <div data-testid="tool-call-card-args" className="text-foreground/70">
              {toolCall.args}
            </div>
          )}
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
      className="flex flex-col divide-y divide-line-row rounded-md border border-border"
    >
      {toolCalls.map((toolCall) => (
        <ToolCallCard key={toolCall.id} toolCall={toolCall} />
      ))}
    </div>
  );
}
