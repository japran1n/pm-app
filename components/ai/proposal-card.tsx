"use client";

// F015/F016: the proposal card — the one place in this app where the AI
// assistant's suggested document edit becomes something the user can see,
// decide on, and (via Accept) actually apply. See this feature's spec
// (missions/20260909-ai-docs/features/F015.md, F016.md) for the full
// rationale; this file's own comments cover only load-bearing decisions
// not already explained there.
//
// Three states, unmistakable at a glance (F015):
//   pending  — attention-toned (status-waiting) card, diff visible, Accept/Reject.
//   accepted — collapsed single success-toned (status-done) row, diff hidden.
//   rejected — collapsed single neutral (muted) row, diff hidden.
// Both Accept and Reject are one-time: once `proposal.status` is anything
// other than "pending" (owned by useDocAssistant, lib/ai/
// use-doc-assistant.ts), the buttons are simply never rendered again —
// there is no code path back to a decision once one has been made.
//
// Reject performs ZERO calls (AS-010) — it is a synchronous state
// transition only, nothing async, nothing that touches the network.
//
// Accept is F016's write path: it calls the server action
// `applyDocEditProposal` (lib/actions/ai-proposals.ts), which is the ONLY
// place in this whole feature pair that writes to the database. Before
// that call, this component:
//   1. Looks up the currently-mounted editor for this doc (if any) via
//      lib/ai/doc-editor-bridge.ts and cancels its pending autosave, so
//      the two writers never race (see markdown-editor.tsx's
//      AUTOSAVE_DEBOUNCE_MS and this feature's spec's "THE RACE" section).
//   2. Compares that editor's LIVE markdown against the proposal's own
//      `currentMarkdown` (the exact base the diff was computed against).
//      A mismatch means the user kept typing after the proposal was
//      generated — reject the write client-side, before ever calling the
//      server action, and surface a clear, non-destructive error. The
//      server action performs the identical check again against the DB
//      row as a second, independent guard (defence in depth — the editor
//      bridge could in principle be stale or absent).
// On success, the editor's own state is pushed to match what was just
// persisted (`applyAcceptedMarkdown`), and only then is the proposal
// marked `accepted` in the hook's state.

import { useState } from "react";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DiffView, countDiffLines } from "@/components/ai/diff-view";
import { getDocEditorHandle } from "@/lib/ai/doc-editor-bridge";
import { applyDocEditProposal, normalizeForStaleCheck } from "@/lib/actions/ai-proposals";
import type { DocEditProposalWithDiff } from "@/lib/ai/tools/propose-doc-edit";
import type { ProposalView } from "@/lib/ai/use-doc-assistant";

const STALE_ERROR_MESSAGE =
  "The document changed since this proposal was made. Please ask the assistant to revise it.";

/**
 * Narrows a proposal's `unknown` payload to the doc-edit shape this card
 * knows how to render. Returns null for anything that doesn't match
 * (including `doc_create`, out of this feature's scope per F015's spec —
 * F017 owns that card) so the caller can render nothing rather than throw
 * on a malformed/unexpected payload.
 */
function asDocEditProposal(payload: unknown): DocEditProposalWithDiff | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<DocEditProposalWithDiff>;
  if (
    candidate.kind === "doc_edit" &&
    typeof candidate.docId === "string" &&
    typeof candidate.docTitle === "string" &&
    typeof candidate.currentMarkdown === "string" &&
    typeof candidate.proposedMarkdown === "string" &&
    Array.isArray(candidate.diff)
  ) {
    return candidate as DocEditProposalWithDiff;
  }
  return null;
}

export function ProposalCard({
  proposal,
  onAccept,
  onReject,
}: {
  proposal: ProposalView;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const data = asDocEditProposal(proposal.payload);
  if (!data) return null;

  const { added, removed } = countDiffLines(data.diff);
  const countLabel = `${added} line${added === 1 ? "" : "s"} added, ${removed} removed`;

  async function handleAccept() {
    if (isApplying) return;
    setApplyError(null);
    setIsApplying(true);
    try {
      const handle = getDocEditorHandle(data!.docId);

      if (handle) {
        // Stop the editor's own debounced autosave before either side
        // reads or writes anything else — this is the fix for the race
        // this feature's spec calls out explicitly.
        handle.cancelPendingSave();

        const liveMarkdown = handle.getCurrentMarkdown();
        if (
          normalizeForStaleCheck(liveMarkdown) !== normalizeForStaleCheck(data!.currentMarkdown)
        ) {
          // Reject the write client-side, before ever reaching the
          // server action — do not apply a stale proposal silently.
          setApplyError(STALE_ERROR_MESSAGE);
          setIsApplying(false);
          return;
        }
      }

      const result = await applyDocEditProposal({
        docId: data!.docId,
        expectedCurrentMarkdown: data!.currentMarkdown,
        proposedMarkdown: data!.proposedMarkdown,
      });

      if (!result.ok) {
        setApplyError(result.error);
        setIsApplying(false);
        return;
      }

      // Success: sync the editor's own state to what was just persisted
      // (no-op if no editor for this doc is currently mounted), then
      // mark the proposal accepted. Order matters — the proposal is only
      // ever marked accepted AFTER the write actually succeeded.
      handle?.applyAcceptedMarkdown(data!.proposedMarkdown);
      onAccept(proposal.id);
    } finally {
      setIsApplying(false);
    }
  }

  function handleReject() {
    // AS-010: zero calls. A plain, synchronous state transition — no
    // fetch, no server action, nothing that could ever touch the
    // database, not even a status update.
    onReject(proposal.id);
  }

  if (proposal.status === "accepted") {
    return (
      <div
        data-testid="proposal-card"
        data-status="accepted"
        className="flex items-center gap-2 rounded-md bg-status-done-bg px-2.5 py-1.5 text-mini text-status-done"
      >
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          Applied: {data.summary || `Edit to "${data.docTitle}"`}
        </span>
      </div>
    );
  }

  if (proposal.status === "rejected") {
    return (
      <div
        data-testid="proposal-card"
        data-status="rejected"
        className="flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-mini text-muted-foreground"
      >
        <X className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          Rejected: {data.summary || `Edit to "${data.docTitle}"`}
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="proposal-card"
      data-status="pending"
      className="flex flex-col gap-2 rounded-md bg-status-waiting-bg p-2.5"
    >
      <p className="text-mini font-medium text-foreground">
        Proposed edit to &quot;{data.docTitle}&quot;
      </p>
      <p data-testid="proposal-card-count" className="text-micro text-status-waiting">
        {countLabel}
      </p>

      <DiffView diff={data.diff} />

      {applyError && (
        <p role="alert" className="text-mini text-status-blocked" data-testid="proposal-card-error">
          {applyError}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="default"
          size="sm"
          onClick={handleAccept}
          disabled={isApplying}
          data-testid="proposal-card-accept"
        >
          <Check className="size-3.5" aria-hidden="true" />
          {isApplying ? "Applying…" : "Accept"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleReject}
          disabled={isApplying}
          data-testid="proposal-card-reject"
        >
          <X className="size-3.5" aria-hidden="true" />
          Reject
        </Button>
      </div>
    </div>
  );
}

export function ProposalList({
  proposals,
  onAccept,
  onReject,
}: {
  proposals: ProposalView[];
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  if (proposals.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="proposal-list">
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.id}
          proposal={proposal}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}
    </div>
  );
}

export default ProposalCard;
