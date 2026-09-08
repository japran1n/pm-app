"use client";

// F113 (missions/20260903-portal, client-portal-phase-2-plan.md item B):
// per-page links, edited from the page's own task detail sheet -- "a
// page's Figma link belongs with the page", not a separate settings
// screen the way `project_links` lives in project settings. Mirrors
// task-detail-sheet.tsx's own `getProjectPhaseOptions` precedent
// (fetch-on-mount via a server action from inside this Client Component,
// see that file's own header) rather than threading a new prop through
// every task-detail caller.
//
// Deliberately compact: three fixed rows (Figma / Staging / Live), not a
// free-form list like `project_links`' settings panel -- a page needs at
// most one of each kind in practice, and a fixed three-row shape is what
// lets pages-table.tsx (AS-113) render one summary affordance per row
// instead of an open-ended list.

import { useEffect, useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  createPageLink,
  deletePageLink,
  getPageLinksForTaskAction,
  updatePageLink,
} from "@/lib/actions/page-links";
import type { PageLink, PageLinkKind } from "@/lib/queries/page-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const ROW_KINDS: { kind: PageLinkKind; label: string; placeholder: string }[] = [
  { kind: "figma", label: "Figma frame", placeholder: "https://figma.com/file/..." },
  { kind: "staging", label: "Staging URL", placeholder: "https://staging.example.com/..." },
  { kind: "live", label: "Live URL", placeholder: "https://example.com/..." },
];

const GENERIC_ERROR = "Something went wrong. Please try again in a moment.";

export function PageLinksEditor({ taskId, canEdit }: { taskId: string; canEdit: boolean }) {
  const [links, setLinks] = useState<PageLink[] | null>(null);
  const [draftUrls, setDraftUrls] = useState<Record<string, string>>({});
  const [isPending, startTransition] = useTransition();

  // Reset state during render when `taskId` changes, rather than
  // synchronously inside the effect below -- this is React's recommended
  // pattern for "adjusting state when a prop changes" and avoids the
  // cascading-render lint error that a same-tick setState-in-effect
  // (react-hooks/set-state-in-effect) would trigger. See
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes
  const [prevTaskId, setPrevTaskId] = useState(taskId);
  if (taskId !== prevTaskId) {
    setPrevTaskId(taskId);
    setLinks(null);
  }

  useEffect(() => {
    let cancelled = false;
    getPageLinksForTaskAction(taskId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setLinks(result.data);
      } else {
        setLinks([]);
        toast.error("Couldn't load this page's links.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  if (links === null) {
    return (
      <div
        className="flex items-center gap-2 text-mini text-muted-foreground"
        data-testid="page-links-editor-loading"
      >
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading links…
      </div>
    );
  }

  const linkByKind = new Map(links.map((link) => [link.kind, link]));

  function commitUrl(kind: PageLinkKind, existing: PageLink | undefined) {
    const rawUrl = (draftUrls[kind] ?? existing?.url ?? "").trim();

    if (!rawUrl) {
      if (existing) {
        startTransition(async () => {
          const result = await deletePageLink(existing.id);
          if (result.ok) {
            setLinks((prev) => (prev ?? []).filter((l) => l.id !== existing.id));
          } else {
            toast.error(result.error ?? GENERIC_ERROR);
          }
        });
      }
      return;
    }

    if (existing && rawUrl === existing.url) return;

    startTransition(async () => {
      const label = ROW_KINDS.find((r) => r.kind === kind)?.label ?? kind;
      const result = existing
        ? await updatePageLink({
            linkId: existing.id,
            kind,
            label,
            url: rawUrl,
            clientVisible: existing.clientVisible,
          })
        : await createPageLink({ taskId, kind, label, url: rawUrl, clientVisible: false });

      if (result.ok) {
        setLinks((prev) => {
          const withoutKind = (prev ?? []).filter((l) => l.kind !== kind);
          return [...withoutKind, result.data];
        });
      } else {
        toast.error(result.error ?? GENERIC_ERROR);
      }
    });
  }

  function toggleClientVisible(existing: PageLink, next: boolean) {
    startTransition(async () => {
      const result = await updatePageLink({
        linkId: existing.id,
        kind: existing.kind,
        label: existing.label,
        url: existing.url,
        clientVisible: next,
      });
      if (result.ok) {
        setLinks((prev) => (prev ?? []).map((l) => (l.id === existing.id ? result.data : l)));
      } else {
        toast.error(result.error ?? GENERIC_ERROR);
      }
    });
  }

  return (
    <div
      data-testid="page-links-editor"
      className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-4"
    >
      <span className="text-mini font-medium text-foreground">Page links</span>
      {ROW_KINDS.map(({ kind, label, placeholder }) => {
        const existing = linkByKind.get(kind);
        return (
          <div key={kind} className="flex flex-col gap-1.5">
            <Label htmlFor={`page-link-${kind}-${taskId}`}>{label}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={`page-link-${kind}-${taskId}`}
                value={draftUrls[kind] ?? existing?.url ?? ""}
                disabled={!canEdit || isPending}
                placeholder={placeholder}
                className="font-mono text-mini"
                data-testid={`page-link-input-${kind}`}
                onChange={(event) =>
                  setDraftUrls((prev) => ({ ...prev, [kind]: event.target.value }))
                }
                onBlur={() => commitUrl(kind, existing)}
              />
              {existing && (
                <label
                  className="flex shrink-0 items-center gap-1.5 text-micro text-muted-foreground"
                  title="Visible to the client in the portal"
                >
                  <Checkbox
                    checked={existing.clientVisible}
                    disabled={!canEdit || isPending}
                    onCheckedChange={(checked) => toggleClientVisible(existing, checked === true)}
                    data-testid={`page-link-visible-${kind}`}
                  />
                  Client-visible
                </label>
              )}
              {existing && canEdit && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={isPending}
                  aria-label={`Remove ${label}`}
                  onClick={() => {
                    setDraftUrls((prev) => ({ ...prev, [kind]: "" }));
                    startTransition(async () => {
                      const result = await deletePageLink(existing.id);
                      if (result.ok) {
                        setLinks((prev) => (prev ?? []).filter((l) => l.id !== existing.id));
                      } else {
                        toast.error(result.error ?? GENERIC_ERROR);
                      }
                    });
                  }}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
