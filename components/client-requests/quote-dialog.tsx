"use client";

// F016: the triage/quote dialog. Verdict is one of three buttons; a
// change_request verdict opens the quote form (hours, amount, currency,
// validity, note) plus the three-question track proposal (design_change /
// dev_change / content_seo — a good default, overridable, and the
// override is logged). Before sending, the dialog's own preview panel
// shows exactly what `components/portal/change-requests-table.tsx` will
// render for this request — the spec's own "how the client will see
// this" instruction, because a price the client reads differently from
// what the PM meant is the most expensive misunderstanding this system
// can produce.
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { sendChangeRequestQuote } from "@/lib/actions/client-requests";
import type { TeamClientRequest } from "@/lib/queries/client-requests";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Verdict = "in_scope" | "change_request" | "warranty";
type Track = "design_change" | "dev_change" | "content_seo";

const TRACK_LABEL: Record<Track, string> = {
  design_change: "Design change (dev QA + design QA)",
  dev_change: "Dev change (dev QA)",
  content_seo: "Content / SEO (requester confirms)",
};

// The three-question rule (spec's own words): propose the track, let the
// team override, and log the override.
function proposeTrack(answers: { design: boolean; dev: boolean; contentOnly: boolean }): Track {
  if (answers.contentOnly && !answers.design && !answers.dev) return "content_seo";
  if (answers.design) return "design_change";
  return "dev_change";
}

export function QuoteDialog({
  request,
  open,
  onOpenChange,
  portalUrl,
}: {
  request: TeamClientRequest;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  portalUrl?: string;
}) {
  const [verdict, setVerdict] = useState<Verdict>(request.scopeVerdict ?? "change_request");
  const [severity, setSeverity] = useState<string>(request.severity ?? "");
  const [hours, setHours] = useState(request.quotedHours != null ? String(request.quotedHours) : "");
  const [amount, setAmount] = useState(
    request.quotedAmount != null ? String(request.quotedAmount) : "",
  );
  const [currency, setCurrency] = useState(request.quoteCurrency ?? "USD");
  const [note, setNote] = useState(request.quoteNote ?? "");
  const [validUntil, setValidUntil] = useState(request.quoteValidUntil ?? "");
  const [needsDesign, setNeedsDesign] = useState(false);
  const [needsDev, setNeedsDev] = useState(true);
  const [contentOnly, setContentOnly] = useState(false);
  const [overrideTrack, setOverrideTrack] = useState<Track | null>(request.track ?? null);
  const [overrideReason, setOverrideReason] = useState("");
  const [isPending, startTransition] = useTransition();

  const proposedTrack = useMemo(
    () => proposeTrack({ design: needsDesign, dev: needsDev, contentOnly }),
    [needsDesign, needsDev, contentOnly],
  );
  const effectiveTrack = overrideTrack ?? proposedTrack;
  const trackOverridden = overrideTrack != null && overrideTrack !== proposedTrack;

  const parsedAmount = amount.trim() === "" ? null : Number(amount);
  const parsedHours = hours.trim() === "" ? null : Number(hours);

  const handleSend = () => {
    startTransition(async () => {
      const result = await sendChangeRequestQuote(
        {
          requestId: request.id,
          scopeVerdict: verdict,
          severity: severity || null,
          quotedHours: verdict === "change_request" ? parsedHours : null,
          quotedAmount: verdict === "change_request" ? parsedAmount : null,
          quoteCurrency: verdict === "change_request" ? currency : null,
          quoteNote: verdict === "change_request" ? note : null,
          quoteValidUntil: verdict === "change_request" ? validUntil : null,
          track: verdict === "change_request" ? effectiveTrack : null,
          trackOverridden: verdict === "change_request" ? trackOverridden : false,
          trackOverrideReason: trackOverridden ? overrideReason : null,
        },
        portalUrl,
      );

      if (!result.ok) {
        toast.error(result.error);
        return;
      }

      toast.success(
        verdict === "change_request"
          ? "Quote sent — the client will see it as a commercial approval."
          : "Verdict saved.",
      );
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Triage: {request.title}</DialogTitle>
          <DialogDescription>
            Classify this request, and — if it&apos;s a change request — quote it before it
            goes back to the client.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {(["in_scope", "change_request", "warranty"] as const).map((v) => (
              <Button
                key={v}
                type="button"
                size="sm"
                variant={verdict === v ? "default" : "outline"}
                onClick={() => setVerdict(v)}
              >
                {v === "in_scope" ? "In scope" : v === "warranty" ? "Warranty" : "Change request"}
              </Button>
            ))}
          </div>

          {verdict === "change_request" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qd-hours">Estimate (hours)</Label>
                  <Input
                    id="qd-hours"
                    type="number"
                    min="0"
                    step="0.5"
                    value={hours}
                    onChange={(e) => setHours(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qd-amount">Price</Label>
                  <Input
                    id="qd-amount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qd-currency">Currency</Label>
                  <Input
                    id="qd-currency"
                    value={currency}
                    maxLength={3}
                    onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qd-valid-until">Quote valid until</Label>
                  <Input
                    id="qd-valid-until"
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="qd-note">Note to the client</Label>
                <Textarea
                  id="qd-note"
                  rows={3}
                  maxLength={2000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  Track — three quick questions, then override if the default is wrong.
                </p>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={needsDesign}
                    onChange={(e) => setNeedsDesign(e.target.checked)}
                  />
                  Does this touch design?
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={needsDev}
                    onChange={(e) => setNeedsDev(e.target.checked)}
                  />
                  Does this touch code?
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={contentOnly}
                    onChange={(e) => setContentOnly(e.target.checked)}
                  />
                  Content/SEO only?
                </label>

                <div className="mt-1 flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Proposed:</span>
                  <Badge variant="secondary">{TRACK_LABEL[proposedTrack]}</Badge>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="qd-track-override">Override track</Label>
                  <Select
                    value={overrideTrack ?? proposedTrack}
                    onValueChange={(v) => setOverrideTrack(v as Track)}
                  >
                    <SelectTrigger id="qd-track-override">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TRACK_LABEL) as Track[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {TRACK_LABEL[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {trackOverridden && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="qd-track-reason">Why override the proposed track?</Label>
                    <Textarea
                      id="qd-track-reason"
                      rows={2}
                      maxLength={500}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div
                className="rounded-md border border-dashed border-border bg-muted/30 p-3"
                data-testid="quote-client-preview"
              >
                <p className="mb-2 text-xs font-medium text-muted-foreground">
                  How the client will see this
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{request.title}</p>
                  <Badge variant="outline">Awaiting your approval</Badge>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  {parsedHours != null && !Number.isNaN(parsedHours) && (
                    <span>Estimate: {parsedHours}h</span>
                  )}
                  {parsedAmount != null && !Number.isNaN(parsedAmount) && (
                    <span>
                      Price:{" "}
                      {new Intl.NumberFormat("en-GB", {
                        style: "currency",
                        currency: currency || "USD",
                      }).format(parsedAmount)}
                    </span>
                  )}
                  {validUntil && <span>Valid until {validUntil}</span>}
                </div>
                {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
              </div>
            </>
          )}

          {verdict !== "change_request" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="qd-severity">Severity (optional)</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v ?? "")}>
                <SelectTrigger id="qd-severity">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="blocker">Blocker</SelectItem>
                  <SelectItem value="major">Major</SelectItem>
                  <SelectItem value="minor">Minor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSend} disabled={isPending}>
            {verdict === "change_request" ? "Send quote" : "Save verdict"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
