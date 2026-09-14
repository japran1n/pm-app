"use client";

// F015 (missions/20260903-portal): the "Record" panel — Scope · Decisions
// · Assumptions, one project settings tab, three inline-editable lists.
// Mirrors components/project/deliverables-panel.tsx's shape one level
// over (Server Component page fetches all three lists and passes them
// down as typed props; this is the only Client Component): inline add,
// inline edit-on-blur, a `client_visible` toggle per row (decisions and
// assumptions only — scope items have no such column, per F012's own
// migration comment: everything in that table is inherently
// client-facing), no separate detail page per row — this feature's own
// spec, verbatim: "a dialog per row would guarantee nobody writes them."
//
// `canManage` only controls whether the mutating controls render, same
// UI-convenience-not-security-boundary convention deliverables-panel.tsx
// documents — every action in lib/actions/project-records.ts
// independently re-checks via withAuthz's default `canWrite` gate.

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createAssumption,
  createDecision,
  createScopeItem,
  deleteAssumption,
  deleteDecision,
  deleteScopeItem,
  restoreAssumption,
  restoreDecision,
  restoreScopeItem,
  updateAssumption,
  updateDecision,
  updateScopeItem,
} from "@/lib/actions/project-records";
import { showUndoToast } from "@/lib/toast/undo-toast";
import { raiseChangeRequestFromAssumption } from "@/lib/actions/client-requests";
import type {
  AssumptionState,
  DecisionType,
  ProjectAssumption,
  ProjectDecision,
  ProjectScopeItem,
  ScopeItemSource,
} from "@/lib/queries/project-records";
import type { TeamClientRequest } from "@/lib/queries/client-requests";
import { QuoteDialog } from "@/components/client-requests/quote-dialog";
import {
  assumptionStateSchema,
  decisionTypeSchema,
  scopeItemSourceSchema,
} from "@/lib/validation/project-records";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

const SOURCE_LABELS: Record<ScopeItemSource, string> = {
  proposal: "Proposal",
  change_request: "Change request",
};

const DECISION_TYPE_LABELS: Record<DecisionType, string> = {
  content: "Content",
  brand: "Brand",
  technical: "Technical",
  commercial: "Commercial",
};

const ASSUMPTION_STATE_LABELS: Record<AssumptionState, string> = {
  assumed: "Assumed",
  confirmed: "Confirmed",
  invalidated: "Invalidated",
};

function DeleteRowButton({
  label,
  onConfirm,
}: {
  label: string;
  onConfirm: () => void;
}) {
  const [isDeleting, startTransition] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={isDeleting}
            aria-label={`Delete ${label}`}
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        }
      />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &ldquo;{label}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes it from the project and the client portal. You can undo this
            for a few seconds right after deleting.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => startTransition(onConfirm)}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------------------------------------------------------------------
// Scope tab
// ---------------------------------------------------------------------

function ScopeRow({
  item,
  onChanged,
  onRemoved,
  onRestored,
}: {
  item: ProjectScopeItem;
  onChanged: (item: ProjectScopeItem) => void;
  onRemoved: (id: string) => void;
  onRestored: (item: ProjectScopeItem) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [included, setIncluded] = useState(item.included);
  const [source, setSource] = useState<ScopeItemSource>(item.source);
  const [isPending, startTransition] = useTransition();

  function submit(next: { title: string; included: boolean; source: ScopeItemSource }) {
    startTransition(async () => {
      const result = await updateScopeItem({
        scopeItemId: item.id,
        title: next.title,
        description: item.description,
        included: next.included,
        source: next.source,
      });
      if (!result.ok) {
        setTitle(item.title);
        setIncluded(item.included);
        setSource(item.source);
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
      <Input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() && title !== item.title && submit({ title, included, source })}
        disabled={isPending}
        className="w-56"
        aria-label="Scope item title"
      />
      <Select
        value={included ? "included" : "excluded"}
        onValueChange={(value) => {
          const next = value === "included";
          setIncluded(next);
          submit({ title, included: next, source });
        }}
        disabled={isPending}
      >
        <SelectTrigger className="w-32" aria-label="In or out of scope">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="included">In scope</SelectItem>
          <SelectItem value="excluded">Not included</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={source}
        onValueChange={(value) => {
          const next = value as ScopeItemSource;
          setSource(next);
          submit({ title, included, source: next });
        }}
        disabled={isPending}
      >
        <SelectTrigger className="w-40" aria-label="Scope item source">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {scopeItemSourceSchema.options.map((value) => (
            <SelectItem key={value} value={value}>
              {SOURCE_LABELS[value]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {item.changeRequestTitle && (
        <span className="text-xs text-muted-foreground">via &ldquo;{item.changeRequestTitle}&rdquo;</span>
      )}
      <div className="ml-auto">
        <DeleteRowButton
          label={item.title}
          onConfirm={async () => {
            const result = await deleteScopeItem(item.id);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            onRemoved(item.id);
            showUndoToast({
              message: "Scope item deleted.",
              description: "This can't be recovered once this undo window closes.",
              onUndo: async () => {
                const restoreResult = await restoreScopeItem(result.data.restore);
                if (!restoreResult.ok) {
                  toast.error(restoreResult.error);
                  return;
                }
                onRestored(restoreResult.data);
              },
            });
          }}
        />
      </div>
    </div>
  );
}

function ScopeTab({
  projectId,
  initialItems,
  canManage,
}: {
  projectId: string;
  initialItems: ProjectScopeItem[];
  canManage: boolean;
}) {
  const [items, setItems] = useState(initialItems);
  // ARCH-009: re-sync from fresh server props the instant a
  // revalidate/router.refresh() delivers them, using the repo's render-time
  // "adjusting state when a prop changes" convention (same as
  // components/workspace/task-type-manager.tsx) — previously this tab kept
  // showing the first render's snapshot forever.
  const [syncedInitialItems, setSyncedInitialItems] = useState(initialItems);
  if (initialItems !== syncedInitialItems) {
    setSyncedInitialItems(initialItems);
    setItems(initialItems);
  }
  const [newTitle, setNewTitle] = useState("");
  const [isAdding, startAddTransition] = useTransition();

  function handleAdd() {
    if (!newTitle.trim()) {
      toast.error("Title is required.");
      return;
    }
    startAddTransition(async () => {
      const result = await createScopeItem({
        projectId,
        title: newTitle,
        included: true,
        source: "proposal",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems((current) => [...current, result.data]);
      setNewTitle("");
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="scope-tab">
      <div className="flex flex-col gap-2">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scope items yet.</p>
        ) : (
          items.map((item) =>
            canManage ? (
              <ScopeRow
                key={item.id}
                item={item}
                onChanged={(next) =>
                  setItems((current) => current.map((i) => (i.id === next.id ? next : i)))
                }
                onRemoved={(id) => setItems((current) => current.filter((i) => i.id !== id))}
                onRestored={(restored) =>
                  setItems((current) =>
                    [...current.filter((i) => i.id !== restored.id), restored].sort(
                      (a, b) => a.position - b.position,
                    ),
                  )
                }
              />
            ) : (
              <div key={item.id} className="rounded-md border border-border p-3 text-sm">
                {item.title} — {item.included ? "In scope" : "Not included"}
              </div>
            ),
          )
        )}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor="new-scope-title" className="sr-only">
            New scope item title
          </Label>
          <Input
            id="new-scope-title"
            placeholder="New scope item"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            disabled={isAdding}
            className="w-56"
          />
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add scope item"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Decisions tab
// ---------------------------------------------------------------------

function DecisionRow({
  decision,
  onChanged,
  onRemoved,
  onRestored,
}: {
  decision: ProjectDecision;
  onChanged: (decision: ProjectDecision) => void;
  onRemoved: (id: string) => void;
  onRestored: (decision: ProjectDecision) => void;
}) {
  const [title, setTitle] = useState(decision.title);
  const [rationale, setRationale] = useState(decision.rationale ?? "");
  const [decisionType, setDecisionType] = useState<DecisionType>(decision.decisionType);
  const [decidedOn, setDecidedOn] = useState(decision.decidedOn);
  const [clientVisible, setClientVisible] = useState(decision.clientVisible);
  const [isPending, startTransition] = useTransition();

  function submit(next: {
    title: string;
    rationale: string;
    decisionType: DecisionType;
    decidedOn: string;
    clientVisible: boolean;
  }) {
    startTransition(async () => {
      const result = await updateDecision({
        decisionId: decision.id,
        phaseId: decision.phaseId,
        title: next.title,
        rationale: next.rationale || null,
        decisionType: next.decisionType,
        decidedOn: next.decidedOn,
        decidedByName: decision.decidedByName,
        clientVisible: next.clientVisible,
      });
      if (!result.ok) {
        setTitle(decision.title);
        setRationale(decision.rationale ?? "");
        setDecisionType(decision.decisionType);
        setDecidedOn(decision.decidedOn);
        setClientVisible(decision.clientVisible);
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() =>
            title.trim() &&
            title !== decision.title &&
            submit({ title, rationale, decisionType, decidedOn, clientVisible })
          }
          disabled={isPending}
          className="w-56"
          aria-label="Decision title"
        />
        <Select
          value={decisionType}
          onValueChange={(value) => {
            const next = value as DecisionType;
            setDecisionType(next);
            submit({ title, rationale, decisionType: next, decidedOn, clientVisible });
          }}
          disabled={isPending}
        >
          <SelectTrigger className="w-36" aria-label="Decision type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {decisionTypeSchema.options.map((value) => (
              <SelectItem key={value} value={value}>
                {DECISION_TYPE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={decidedOn}
          onChange={(e) => setDecidedOn(e.target.value)}
          onBlur={() => submit({ title, rationale, decisionType, decidedOn, clientVisible })}
          disabled={isPending}
          className="w-40"
          aria-label={`${decision.title} decided on`}
        />
        <div className="ml-auto flex items-center gap-2">
          <Switch
            checked={clientVisible}
            onCheckedChange={(checked) => {
              setClientVisible(checked);
              submit({ title, rationale, decisionType, decidedOn, clientVisible: checked });
            }}
            disabled={isPending}
            aria-label={`${decision.title} visible to client`}
          />
          <span className="text-xs text-muted-foreground">
            {clientVisible ? "Visible to client" : "Internal only"}
          </span>
          <DeleteRowButton
            label={decision.title}
            onConfirm={async () => {
              const result = await deleteDecision(decision.id);
              if (!result.ok) {
                toast.error(result.error);
                return;
              }
              onRemoved(decision.id);
              // F090 item 5: decisions are one of this audit's own named
              // candidates for real soft-delete (see deleteDecision's own
              // comment in lib/actions/project-records.ts) -- this
              // reinsert-on-undo is the pragmatic interim fix, not that
              // larger migration.
              showUndoToast({
                message: "Decision deleted.",
                description: "This can't be recovered once this undo window closes.",
                onUndo: async () => {
                  const restoreResult = await restoreDecision(result.data.restore);
                  if (!restoreResult.ok) {
                    toast.error(restoreResult.error);
                    return;
                  }
                  onRestored(restoreResult.data);
                },
              });
            }}
          />
        </div>
      </div>
      <Textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        onBlur={() => submit({ title, rationale, decisionType, decidedOn, clientVisible })}
        disabled={isPending}
        placeholder="Rationale"
        className="min-h-14"
        aria-label={`${decision.title} rationale`}
      />
    </div>
  );
}

function DecisionsTab({
  projectId,
  initialDecisions,
  canManage,
}: {
  projectId: string;
  initialDecisions: ProjectDecision[];
  canManage: boolean;
}) {
  const [decisions, setDecisions] = useState(
    [...initialDecisions].sort((a, b) => (a.decidedOn < b.decidedOn ? 1 : -1)),
  );
  const [newTitle, setNewTitle] = useState("");
  const [isAdding, startAddTransition] = useTransition();

  function handleAdd() {
    if (!newTitle.trim()) {
      toast.error("Title is required.");
      return;
    }
    startAddTransition(async () => {
      const result = await createDecision({
        projectId,
        title: newTitle,
        decisionType: "content",
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setDecisions((current) =>
        [result.data, ...current].sort((a, b) => (a.decidedOn < b.decidedOn ? 1 : -1)),
      );
      setNewTitle("");
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="decisions-tab">
      <div className="flex flex-col gap-2">
        {decisions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No decisions logged yet.</p>
        ) : (
          decisions.map((decision) =>
            canManage ? (
              <DecisionRow
                key={decision.id}
                decision={decision}
                onChanged={(next) =>
                  setDecisions((current) =>
                    current
                      .map((d) => (d.id === next.id ? next : d))
                      .sort((a, b) => (a.decidedOn < b.decidedOn ? 1 : -1)),
                  )
                }
                onRemoved={(id) =>
                  setDecisions((current) => current.filter((d) => d.id !== id))
                }
                onRestored={(restored) =>
                  setDecisions((current) =>
                    [...current.filter((d) => d.id !== restored.id), restored].sort(
                      (a, b) => (a.decidedOn < b.decidedOn ? 1 : -1),
                    ),
                  )
                }
              />
            ) : (
              <div key={decision.id} className="rounded-md border border-border p-3 text-sm">
                {decision.title}
              </div>
            ),
          )
        )}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor="new-decision-title" className="sr-only">
            New decision title
          </Label>
          <Input
            id="new-decision-title"
            placeholder="New decision"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            disabled={isAdding}
            className="w-56"
          />
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add decision"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Assumptions tab
// ---------------------------------------------------------------------

function AssumptionRow({
  assumption,
  onChanged,
  onRemoved,
  onRestored,
  onRaised,
}: {
  assumption: ProjectAssumption;
  onChanged: (assumption: ProjectAssumption) => void;
  onRemoved: (id: string) => void;
  onRestored: (assumption: ProjectAssumption) => void;
  onRaised: (request: TeamClientRequest) => void;
}) {
  const [text, setText] = useState(assumption.text);
  const [state, setState] = useState<AssumptionState>(assumption.state);
  const [clientVisible, setClientVisible] = useState(assumption.clientVisible);
  const [isPending, startTransition] = useTransition();
  const [isRaising, startRaiseTransition] = useTransition();

  // F016b: turns this flagged assumption into a change request. Only the
  // client_requests row is created here — pre-filled with the
  // assumption's own text/flagged_note, kind='change',
  // scope_verdict='change_request', linked back via
  // origin_assumption_id — the quote itself is still sent through
  // F016's own, unmodified QuoteDialog/sendChangeRequestQuote path.
  function handleRaise() {
    startRaiseTransition(async () => {
      const result = await raiseChangeRequestFromAssumption(assumption.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onRaised({
        id: result.data.requestId,
        projectId: result.data.projectId,
        projectName: "",
        title: result.data.title,
        body: result.data.body,
        desiredBy: null,
        status: "submitted",
        declineReason: null,
        convertedTaskId: null,
        createdAt: result.data.createdAt,
        requesterId: "",
        requesterName: null,
        requesterEmail: null,
        scopeVerdict: "change_request",
        severity: null,
        quotedHours: null,
        quotedAmount: null,
        quoteCurrency: null,
        quoteNote: null,
        quoteValidUntil: null,
        clientDecision: "pending",
        track: null,
        trackOverridden: false,
      });
    });
  }

  function submit(next: { text: string; state: AssumptionState; clientVisible: boolean }) {
    startTransition(async () => {
      const result = await updateAssumption({
        assumptionId: assumption.id,
        text: next.text,
        state: next.state,
        clientVisible: next.clientVisible,
      });
      if (!result.ok) {
        setText(assumption.text);
        setState(assumption.state);
        setClientVisible(assumption.clientVisible);
        toast.error(result.error);
        return;
      }
      onChanged(result.data);
    });
  }

  const isFlagged = Boolean(assumption.flaggedByClientAt) && assumption.state === "assumed";

  return (
    <div
      className={
        isFlagged
          ? "flex flex-col gap-2 rounded-md border border-[color:var(--status-blocked)] bg-[color:var(--status-blocked)]/10 p-3"
          : "flex flex-col gap-2 rounded-md border border-border p-3"
      }
      data-testid="assumption-row"
    >
      {isFlagged && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-[color:var(--status-blocked)]">
            Flagged by the client: &ldquo;{assumption.flaggedNote}&rdquo;
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={isRaising}
            onClick={handleRaise}
          >
            {isRaising ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Raise a change request"
            )}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() =>
            text.trim() &&
            text !== assumption.text &&
            submit({ text, state, clientVisible })
          }
          disabled={isPending}
          className="min-h-9 flex-1"
          aria-label="Assumption text"
        />
        <Select
          value={state}
          onValueChange={(value) => {
            const next = value as AssumptionState;
            setState(next);
            submit({ text, state: next, clientVisible });
          }}
          disabled={isPending}
        >
          <SelectTrigger className="w-36" aria-label="Assumption state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {assumptionStateSchema.options.map((value) => (
              <SelectItem key={value} value={value}>
                {ASSUMPTION_STATE_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Switch
          checked={clientVisible}
          onCheckedChange={(checked) => {
            setClientVisible(checked);
            submit({ text, state, clientVisible: checked });
          }}
          disabled={isPending}
          aria-label="Visible to client"
        />
        <DeleteRowButton
          label={text.slice(0, 40)}
          onConfirm={async () => {
            const result = await deleteAssumption(assumption.id);
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            onRemoved(assumption.id);
            showUndoToast({
              message: "Assumption deleted.",
              description: "This can't be recovered once this undo window closes.",
              onUndo: async () => {
                const restoreResult = await restoreAssumption(result.data.restore);
                if (!restoreResult.ok) {
                  toast.error(restoreResult.error);
                  return;
                }
                onRestored(restoreResult.data);
              },
            });
          }}
        />
      </div>
    </div>
  );
}

function AssumptionsTab({
  projectId,
  workspaceSlug,
  initialAssumptions,
  canManage,
}: {
  projectId: string;
  workspaceSlug: string;
  initialAssumptions: ProjectAssumption[];
  canManage: boolean;
}) {
  const [assumptions, setAssumptions] = useState(initialAssumptions);
  // ARCH-009: same render-time re-sync convention as ScopeTab above.
  const [syncedInitialAssumptions, setSyncedInitialAssumptions] =
    useState(initialAssumptions);
  if (initialAssumptions !== syncedInitialAssumptions) {
    setSyncedInitialAssumptions(initialAssumptions);
    setAssumptions(initialAssumptions);
  }
  const [newText, setNewText] = useState("");
  const [isAdding, startAddTransition] = useTransition();
  const [quoteRequest, setQuoteRequest] = useState<TeamClientRequest | null>(null);

  function handleAdd() {
    if (!newText.trim()) {
      toast.error("Assumption text is required.");
      return;
    }
    startAddTransition(async () => {
      const result = await createAssumption({ projectId, text: newText });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setAssumptions((current) => [...current, result.data]);
      setNewText("");
    });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="assumptions-tab">
      <div className="flex flex-col gap-2">
        {assumptions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No assumptions recorded yet.</p>
        ) : (
          assumptions.map((assumption) =>
            canManage ? (
              <AssumptionRow
                key={assumption.id}
                assumption={assumption}
                onChanged={(next) =>
                  setAssumptions((current) => current.map((a) => (a.id === next.id ? next : a)))
                }
                onRemoved={(id) =>
                  setAssumptions((current) => current.filter((a) => a.id !== id))
                }
                onRestored={(restored) =>
                  setAssumptions((current) => [
                    ...current.filter((a) => a.id !== restored.id),
                    restored,
                  ])
                }
                onRaised={(request) => setQuoteRequest(request)}
              />
            ) : (
              <div key={assumption.id} className="rounded-md border border-border p-3 text-sm">
                {assumption.text}
              </div>
            ),
          )
        )}
      </div>
      {canManage && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border p-3">
          <Label htmlFor="new-assumption-text" className="sr-only">
            New assumption
          </Label>
          <Input
            id="new-assumption-text"
            placeholder="New assumption"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            disabled={isAdding}
            className="w-64"
          />
          <Button type="button" onClick={handleAdd} disabled={isAdding}>
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add assumption"}
          </Button>
        </div>
      )}

      {quoteRequest && (
        <QuoteDialog
          request={quoteRequest}
          open={quoteRequest != null}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setQuoteRequest(null);
          }}
          portalUrl={
            typeof window !== "undefined"
              ? `${window.location.origin}/portal/${workspaceSlug}/p/${quoteRequest.projectId}/scope`
              : undefined
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// RecordPanel
// ---------------------------------------------------------------------

export function RecordPanel({
  projectId,
  workspaceSlug,
  initialScopeItems,
  initialDecisions,
  initialAssumptions,
  canManage,
}: {
  projectId: string;
  workspaceSlug: string;
  initialScopeItems: ProjectScopeItem[];
  initialDecisions: ProjectDecision[];
  initialAssumptions: ProjectAssumption[];
  canManage: boolean;
}) {
  return (
    <Tabs defaultValue="scope">
      <TabsList>
        <TabsTrigger value="scope">Scope</TabsTrigger>
        <TabsTrigger value="decisions">Decisions</TabsTrigger>
        <TabsTrigger value="assumptions">Assumptions</TabsTrigger>
      </TabsList>
      <TabsContent value="scope">
        <ScopeTab projectId={projectId} initialItems={initialScopeItems} canManage={canManage} />
      </TabsContent>
      <TabsContent value="decisions">
        <DecisionsTab
          projectId={projectId}
          initialDecisions={initialDecisions}
          canManage={canManage}
        />
      </TabsContent>
      <TabsContent value="assumptions">
        <AssumptionsTab
          projectId={projectId}
          workspaceSlug={workspaceSlug}
          initialAssumptions={initialAssumptions}
          canManage={canManage}
        />
      </TabsContent>
    </Tabs>
  );
}
