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
import { usePathname } from "next/navigation";
import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DiffView, countDiffLines } from "@/components/ai/diff-view";
import { getDocEditorHandle } from "@/lib/ai/doc-editor-bridge";
import { logger } from "@/lib/observability/logger";
import {
  applyDocCreateProposal,
  applyDocEditProposal,
  normalizeForStaleCheck,
} from "@/lib/actions/ai-proposals";
import type { DocEditProposalWithDiff } from "@/lib/ai/tools/propose-doc-edit";
import type { DocCreateProposal } from "@/lib/ai/tools/types";
import type { ProposalView } from "@/lib/ai/use-doc-assistant";

/** Trims to a preview length without splitting mid-word where avoidable. */
const CONTENT_PREVIEW_CHARS = 200;

function previewMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (trimmed.length <= CONTENT_PREVIEW_CHARS) return trimmed;
  return `${trimmed.slice(0, CONTENT_PREVIEW_CHARS).trimEnd()}…`;
}

/**
 * Same `/w/<slug>/...` parse `components/ai/assistant-sidebar.tsx`'s own
 * `useWorkspaceSlugFromPath` already uses — duplicated here (rather than
 * exported/shared) since this feature's Touches is scoped to
 * `proposal-card.tsx` and `lib/actions/ai-proposals.ts`, not a refactor of
 * assistant-sidebar.tsx's internals.
 */
function useWorkspaceSlugFromPath(): string | null {
  const pathname = usePathname();
  if (!pathname) return null;
  const match = pathname.match(/^\/w\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Narrows a proposal's `unknown` payload to the doc-create shape this card
 * knows how to render.
 */
function asDocCreateProposal(payload: unknown): DocCreateProposal | null {
  if (!payload || typeof payload !== "object") return null;
  const candidate = payload as Partial<DocCreateProposal>;
  if (
    candidate.kind === "doc_create" &&
    typeof candidate.title === "string" &&
    typeof candidate.markdown === "string" &&
    (candidate.folderId === null || typeof candidate.folderId === "string") &&
    (candidate.templateName === null || typeof candidate.templateName === "string")
  ) {
    return candidate as DocCreateProposal;
  }
  return null;
}

const STALE_ERROR_MESSAGE =
  "The document changed since this proposal was made. Please ask the assistant to revise it.";

/** Shown when the accept server action throws rather than resolving to an
 * `{ ok: false }` / `{ error }` result — same generic phrasing convention
 * used elsewhere in this app for unexpected failures. */
const GENERIC_APPLY_ERROR_MESSAGE = "Something went wrong. Please try again in a moment.";

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

/**
 * The `doc_create` counterpart to `ProposalCard`'s `doc_edit` rendering
 * below, following the same three-state shape (pending/accepted/rejected,
 * one-time decision) established there. Split into its own component
 * rather than a branch inside `ProposalCard` because its Accept path calls
 * a different server action with a different result shape (`{ id } |
 * { error }`, not `{ ok: true } | { ok: false; error }`) and needs an
 * additional `workspaceId` prop `doc_edit` proposals never needed
 * (`applyDocEditProposal` resolves the target doc, and therefore its
 * workspace, from `docId` alone).
 */
function DocCreateProposalCard({
  proposal,
  data,
  workspaceId,
  onAccept,
  onReject,
}: {
  proposal: ProposalView;
  data: DocCreateProposal;
  workspaceId: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [createdDocId, setCreatedDocId] = useState<string | null>(null);
  const workspaceSlug = useWorkspaceSlugFromPath();

  async function handleAccept() {
    if (isApplying) return;
    setApplyError(null);
    setIsApplying(true);
    try {
      const result = await applyDocCreateProposal({
        workspaceId,
        title: data.title,
        markdown: data.markdown,
        folderId: data.folderId,
      });

      if ("error" in result) {
        setApplyError(result.error);
        setIsApplying(false);
        return;
      }

      // Success: this component never navigates itself (per this
      // feature's spec — "do not navigate server-side; let the client
      // decide") — it renders a link to the new doc once one exists and
      // lets the user click through when they're ready.
      setCreatedDocId(result.id);
      onAccept(proposal.id);
    } catch (err) {
      // A thrown server action (network drop, 500, stale action id after a
      // deploy) must not leave Accept silently re-armed with no feedback
      // (M3-SCRUTINY.md BLOCKER-1 / AS-065) — surface it the same way a
      // `{ error }` result is surfaced above.
      logger.error("DocCreateProposalCard: applyDocCreateProposal threw", { error: err });
      setApplyError(GENERIC_APPLY_ERROR_MESSAGE);
    } finally {
      setIsApplying(false);
    }
  }

  function handleReject() {
    // Same zero-calls contract as the doc_edit card's Reject (AS-010) —
    // a plain, synchronous state transition, nothing async.
    onReject(proposal.id);
  }

  const docHref =
    createdDocId && workspaceSlug ? `/w/${workspaceSlug}/docs/${createdDocId}` : null;

  if (proposal.status === "accepted") {
    return (
      <div
        data-testid="proposal-card"
        data-status="accepted"
        className="flex items-center gap-2 rounded-md bg-status-done-bg px-2.5 py-1.5 text-mini text-status-done"
      >
        <Check className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Created: &quot;{data.title}&quot;</span>
        {docHref && (
          <a
            href={docHref}
            className="shrink-0 rounded-sm font-medium underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="proposal-card-open-doc"
          >
            Open
          </a>
        )}
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
        <span className="min-w-0 flex-1 truncate">Discarded: &quot;{data.title}&quot;</span>
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
        New document: &quot;{data.title}&quot;
      </p>
      <p data-testid="proposal-card-meta" className="text-micro text-status-waiting">
        {data.folderId ? "In a folder" : "Docs root"}
        {data.templateName ? ` · From template "${data.templateName}"` : ""}
      </p>
      <p
        data-testid="proposal-card-content-preview"
        className="whitespace-pre-wrap text-mini text-foreground"
      >
        {previewMarkdown(data.markdown) || "(empty document)"}
      </p>

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
          {isApplying ? "Creating…" : "Accept"}
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

export function ProposalCard({
  proposal,
  workspaceId,
  onAccept,
  onReject,
}: {
  proposal: ProposalView;
  workspaceId: string;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  const createData = asDocCreateProposal(proposal.payload);
  if (createData) {
    return (
      <DocCreateProposalCard
        proposal={proposal}
        data={createData}
        workspaceId={workspaceId}
        onAccept={onAccept}
        onReject={onReject}
      />
    );
  }

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
    } catch (err) {
      // See DocCreateProposalCard.handleAccept above — a thrown server
      // action must surface an error, not silently re-arm Accept
      // (M3-SCRUTINY.md BLOCKER-1 / AS-065).
      logger.error("ProposalCard: applyDocEditProposal threw", { error: err });
      setApplyError(GENERIC_APPLY_ERROR_MESSAGE);
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
  workspaceId,
  onAccept,
  onReject,
}: {
  proposals: ProposalView[];
  workspaceId: string;
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
          workspaceId={workspaceId}
          onAccept={onAccept}
          onReject={onReject}
        />
      ))}
    </div>
  );
}

export default ProposalCard;
