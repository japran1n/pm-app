"use client";

// F080 (missions/20260903-portal, hardening): the "Client portal" project
// settings tab — an enable/disable control for `projects.portal_enabled`
// (previously unwritable anywhere in the app; only the demo seed script,
// through the admin client, ever set it), a readiness checklist beside
// it, a link to preview-as-client for this project, and an editor for
// the five launch/warranty fields the portal's own launch-day card
// renders (`target_launch_date`, `launch_confidence`, `launch_note`,
// `warranty_until`, `warranty_terms`) — none of which had an editor
// anywhere before this feature either.
//
// Mirrors components/project/site-panel.tsx's shape: a Server Component
// page fetches everything and passes it down as typed props; this is the
// only Client Component. `canManagePortal`/`canEditLaunch` only control
// whether the mutating controls render — a UI convenience, not the
// security boundary; `setPortalEnabled`/`updateProjectLaunch`
// independently re-check via withAuthz server-side.

import Link from "next/link";
import { useState, useTransition } from "react";
import { CheckCircle2, Circle, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setPortalEnabled, updateProjectLaunch } from "@/lib/actions/portal-settings";
import { useMembership } from "@/components/auth/membership-provider";
import type { PortalLaunchConfidence } from "@/lib/queries/portal";
import type { PortalReadiness } from "@/lib/queries/portal-settings";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const CONFIDENCE_LABELS: Record<PortalLaunchConfidence, string> = {
  on_track: "On track",
  at_risk: "At risk",
  slipped: "Slipped",
};

function ReadinessRow({ met, label }: { met: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2 text-sm" data-testid="portal-readiness-item">
      {met ? (
        <CheckCircle2 className="size-4 shrink-0 text-status-done" aria-hidden="true" />
      ) : (
        <Circle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className={met ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

export function PortalSettingsPanel({
  workspaceSlug,
  projectId,
  portalEnabled: initialPortalEnabled,
  readiness,
  canManagePortal,
  canEditLaunch,
  launch,
}: {
  workspaceSlug: string;
  projectId: string;
  portalEnabled: boolean;
  readiness: PortalReadiness;
  canManagePortal: boolean;
  canEditLaunch: boolean;
  launch: {
    targetLaunchDate: string | null;
    launchConfidence: PortalLaunchConfidence | null;
    launchNote: string | null;
    warrantyUntil: string | null;
    warrantyTerms: string | null;
  };
}) {
  const clientPreviewEnabled = useMembership()?.clientPreviewEnabled ?? false;
  const [portalEnabled, setPortalEnabledState] = useState(initialPortalEnabled);
  const [isTogglePending, startToggleTransition] = useTransition();

  const [targetLaunchDate, setTargetLaunchDate] = useState(launch.targetLaunchDate ?? "");
  const [launchConfidence, setLaunchConfidence] = useState<PortalLaunchConfidence | "">(
    launch.launchConfidence ?? "",
  );
  const [launchNote, setLaunchNote] = useState(launch.launchNote ?? "");
  const [warrantyUntil, setWarrantyUntil] = useState(launch.warrantyUntil ?? "");
  const [warrantyTerms, setWarrantyTerms] = useState(launch.warrantyTerms ?? "");
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunchPending, startLaunchTransition] = useTransition();

  function handleToggle(next: boolean) {
    const previous = portalEnabled;
    setPortalEnabledState(next);
    startToggleTransition(async () => {
      const result = await setPortalEnabled(projectId, next);
      if (result.ok) {
        toast.success(next ? "Client portal turned on." : "Client portal turned off.");
      } else {
        setPortalEnabledState(previous);
        toast.error(result.error);
      }
    });
  }

  function handleLaunchSubmit(formEvent: React.FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    setLaunchError(null);

    startLaunchTransition(async () => {
      const result = await updateProjectLaunch({
        projectId,
        targetLaunchDate: targetLaunchDate || null,
        launchConfidence: launchConfidence || null,
        launchNote: launchNote.trim() ? launchNote : null,
        warrantyUntil: warrantyUntil || null,
        warrantyTerms: warrantyTerms.trim() ? warrantyTerms : null,
      });

      if (result.ok) {
        toast.success("Launch details saved.");
      } else {
        setLaunchError(result.error);
        toast.error(result.error);
      }
    });
  }

  const readinessItems: { met: boolean; label: string }[] = [
    { met: readiness.hasClientMember, label: "A client is a member of this project" },
    { met: readiness.hasPhase, label: "At least one phase exists" },
    { met: readiness.hasClientVisibleTask, label: "At least one task is marked client-visible" },
  ];
  const readinessMetCount = readinessItems.filter((item) => item.met).length;

  const confidenceRequiresNote =
    !!launchConfidence && launchConfidence !== "on_track" && !launchNote.trim();

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4" data-testid="portal-enable-section">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Switch
              checked={portalEnabled}
              onCheckedChange={handleToggle}
              disabled={!canManagePortal || isTogglePending}
              aria-label="Turn on client portal"
              data-testid="portal-enabled-toggle"
            />
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                Client portal is {portalEnabled ? "on" : "off"}
              </span>
              <span className="text-xs text-muted-foreground">
                {canManagePortal
                  ? "Only a workspace owner or admin can change this."
                  : "Only a workspace owner or admin can turn this on or off."}
              </span>
            </div>
          </div>

          {clientPreviewEnabled && (
            <Link
              href={`/w/${workspaceSlug}/preview-as-client?projectId=${projectId}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
              data-testid="portal-preview-as-client-link"
            >
              <ExternalLink className="mr-1.5 size-4" aria-hidden="true" />
              Preview as client
            </Link>
          )}
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-border p-4">
          <span className="text-sm font-medium">
            Readiness ({readinessMetCount}/{readinessItems.length})
          </span>
          <p className="text-xs text-muted-foreground">
            Turning the portal on for a project with none of these shows the client an empty
            shell — not a hard requirement, but worth checking first.
          </p>
          <ul className="flex flex-col gap-1.5 pt-1">
            {readinessItems.map((item) => (
              <ReadinessRow key={item.label} met={item.met} label={item.label} />
            ))}
          </ul>
        </div>
      </section>

      <section className="flex flex-col gap-4" data-testid="portal-launch-section">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Launch &amp; warranty</h2>
          <p className="text-sm text-muted-foreground">
            Shown on the portal&rsquo;s launch-day card.
          </p>
        </div>

        <form onSubmit={handleLaunchSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-target-launch-date">Target launch date</Label>
              <Input
                id="portal-target-launch-date"
                type="date"
                value={targetLaunchDate}
                onChange={(event) => setTargetLaunchDate(event.target.value)}
                disabled={!canEditLaunch || isLaunchPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-launch-confidence">Launch confidence</Label>
              <Select
                value={launchConfidence || undefined}
                onValueChange={(value) =>
                  setLaunchConfidence(value as PortalLaunchConfidence)
                }
                disabled={!canEditLaunch || isLaunchPending}
              >
                <SelectTrigger id="portal-launch-confidence" aria-label="Launch confidence">
                  {/* F090 item 4: Radix's <Select.Value> only renders a
                      registered SelectItem's own children once
                      SelectContent has actually mounted (it lives in a
                      portal, so that's only after the user opens the
                      dropdown) -- until then it falls back to the raw
                      `value` string, which rendered the bare `on_track`
                      enum on first paint. Passing the already-computed
                      label as an explicit child bypasses that fallback
                      entirely, matching every other confidence display
                      in this codebase (portal-topbar.tsx, launch-day-
                      card.tsx, overview-tiles.tsx) that already looks the
                      value up through its own label map. */}
                  <SelectValue placeholder="Not set">
                    {launchConfidence ? CONFIDENCE_LABELS[launchConfidence] : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONFIDENCE_LABELS) as PortalLaunchConfidence[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {CONFIDENCE_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-warranty-until">Warranty until</Label>
              <Input
                id="portal-warranty-until"
                type="date"
                value={warrantyUntil}
                onChange={(event) => setWarrantyUntil(event.target.value)}
                disabled={!canEditLaunch || isLaunchPending}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="portal-warranty-terms">Warranty terms</Label>
              <Input
                id="portal-warranty-terms"
                value={warrantyTerms}
                onChange={(event) => setWarrantyTerms(event.target.value)}
                placeholder="What's covered, in plain English"
                disabled={!canEditLaunch || isLaunchPending}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="portal-launch-note">
              Note{" "}
              {confidenceRequiresNote && (
                <span className="text-destructive">(required when confidence isn&rsquo;t &ldquo;On track&rdquo;)</span>
              )}
            </Label>
            <Textarea
              id="portal-launch-note"
              value={launchNote}
              onChange={(event) => setLaunchNote(event.target.value)}
              placeholder="Explain the delay or risk, so this isn't an alarm with no instruction."
              disabled={!canEditLaunch || isLaunchPending}
              rows={3}
            />
          </div>

          {launchError && (
            <p role="alert" className="text-sm text-destructive">
              {launchError}
            </p>
          )}

          {canEditLaunch && (
            <div>
              <Button type="submit" disabled={isLaunchPending || confidenceRequiresNote}>
                {isLaunchPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
                Save launch details
              </Button>
            </div>
          )}
        </form>
      </section>
    </div>
  );
}
