"use client";

// Mission 20260910-182104, F008 (AS-025): a section card shows the
// section name. Also shows the linked component's name as secondary text
// when present -- the visual distinction (chip/border colour) between
// sections with and without a component lands in F027/F032; this card
// only needs to surface the plain text for now.
//
// `data-component` carries the linked component's id (or is omitted when
// there is none) so F033's board-wide hover-linking can select every
// section card sharing a component via `[data-component="<id>"]` once the
// board root sets `data-hover-component`.
//
// Mission 20260910-182104, F015 (AS-007, AS-034, AS-040): the section
// title is now inline-editable on the board, mirroring
// PageColumnHeader's rename affordance (components/architecture/
// page-column-header.tsx, F014) for a page. A section IS a subtask of
// its page task (standing decision 1), so renaming it updates the same
// `title` column the task list view reads elsewhere -- AS-007 falls out
// for free from sharing that one column, with no separate display name
// to keep in sync.
//
// Click the section title to enter edit mode (AS-034):
// - Enter saves via `renameSection` (lib/actions/architecture.ts) and
//   refreshes the route so the task list view picks up the new title.
// - Escape cancels and reverts to the last saved name, discarding the
//   in-progress edit.
// - An empty (post-trim) name is rejected client-side before the action
//   is even called, with a subtle inline error, and `renameSection`
//   itself also rejects empty names server-side (AS-040, defense in
//   depth).
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText } from "lucide-react";

import { useArchitectureActions } from "@/lib/architecture/actions-context";
import { Input } from "@/components/ui/input";
import type { BoardComponent, BoardSection } from "@/lib/queries/architecture";
import { SectionCardMenu } from "@/components/architecture/section-card-menu";
import { sectionKindAccentClassName } from "@/lib/architecture/section-tint";
import type { ArchitectureNodeDetails, NodeMeta } from "@/lib/architecture/types";
import { NodeMetaDialog } from "@/components/architecture/node-meta-dialog";

// F025 (AS-090): "full" means the copy-brief meta actually carries
// content worth reading -- any of the free-text/keyword fields set.
// `copyStatus` alone starting at "not_started" doesn't count as empty by
// itself (a brief can be drafted without moving that field), but with no
// other field populated there is nothing to show, so it still reads as
// empty.
function hasNodeMetaContent(meta: NodeMeta | null | undefined): boolean {
  if (!meta) return false;
  return Boolean(
    meta.intent ||
      meta.audience ||
      meta.primaryCta ||
      meta.tone ||
      meta.keywords.length > 0,
  );
}

// Mission 20260919-150607, F007 (AS-029..AS-032): a small CMS badge on a
// section card, mirroring PageKindBadge's anatomy (components/architecture/
// page-kind-badge.tsx) -- pill, uppercase, 9px, tracking-[0.07em], 1px
// border, 10% tint -- using the same --cms-* tokens as the existing
// sectionKindAccentClassName tint so the two visually agree. Shown only
// when section.kind === "cms"; coexists with (does not replace) the tint.
function CmsSectionBadge() {
  return (
    <span
      data-section-cms-badge=""
      className="inline-flex w-fit shrink-0 items-center justify-center rounded-full border border-[var(--cms-border)] bg-[var(--cms)]/10 px-[5.5px] py-[3px] text-[9px] font-medium tracking-[0.07em] whitespace-nowrap text-[var(--cms-foreground)] uppercase"
    >
      CMS
    </span>
  );
}

// F024 (AS-097): `detailsData` is the same lazily-fetched
// ArchitectureNodeDetails map already threaded to page nodes (see
// architecture-view-toggle.tsx / page-column.tsx / canvas-board.tsx) --
// reused here rather than issuing a second `getArchitectureNodeDetails`
// call. It is keyed by task_id, and a section IS a subtask of its page
// task (standing decision 1), so `detailsData.get(section.id)` resolves
// to that section's own copy-brief meta + estimates. Optional and unused
// for now -- M4's NodeMetaDialog icon consumes it once it lands.
export function SectionCard({
  section,
  components = [],
  onComponentClick,
  detailsData,
  onDetailsInvalidate,
}: {
  section: BoardSection;
  components?: BoardComponent[];
  onComponentClick?: (componentId: string) => void;
  detailsData?: ArchitectureNodeDetails | null;
  /** F094: called after NodeMetaDialog saves, so the board-wide lazily
   *  fetched details cache (owned by architecture-view-toggle.tsx) drops
   *  and refetches -- router.refresh() alone only re-renders server
   *  components, it never re-runs the client-side details fetch, so
   *  without this the icon stayed in its stale "empty" state until a
   *  full page reload. */
  onDetailsInvalidate: () => void;
}) {
  const { renameSection, readOnly, nodeMeta: nodeMetaCapability } = useArchitectureActions();
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(section.title);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [metaOpen, setMetaOpen] = useState(false);

  // F025 (AS-088..AS-090): `detailsData` is the lazily-fetched map threaded
  // in by F024, keyed by task id -- a section IS a subtask of its page task
  // (standing decision 1), so `detailsData.get(section.id)` resolves to
  // this section's own copy-brief meta. `detailsData` itself being
  // null/undefined means the details fetch hasn't resolved yet, so the
  // icon is withheld entirely rather than guessing a state.
  const sectionDetails = detailsData?.get(section.id);
  const nodeMeta = sectionDetails?.meta ?? null;
  const nodeMetaHasContent = hasNodeMetaContent(nodeMeta);

  function startEditing() {
    setValue(section.title);
    setError(null);
    setIsEditing(true);
  }

  function cancelEditing() {
    setValue(section.title);
    setError(null);
    setIsEditing(false);
  }

  function save() {
    const trimmed = value.trim();

    // AS-040: a section cannot be saved with an empty name -- reject
    // before ever calling the server action.
    if (!trimmed) {
      setError("Section name is required.");
      return;
    }

    if (trimmed === section.title) {
      setIsEditing(false);
      return;
    }

    startTransition(async () => {
      const result = await renameSection(section.id, trimmed);

      if (result.success) {
        setIsEditing(false);
        router.refresh();
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
        toast.error(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  function handleKeyDown(keyEvent: React.KeyboardEvent<HTMLInputElement>) {
    if (keyEvent.key === "Enter") {
      keyEvent.preventDefault();
      save();
    } else if (keyEvent.key === "Escape") {
      keyEvent.preventDefault();
      cancelEditing();
    }
  }

  return (
    <div
      data-component={section.component?.id ?? undefined}
      data-section-kind={section.kind}
      data-node-meta-state={
        detailsData !== null && detailsData !== undefined
          ? nodeMetaHasContent
            ? "full"
            : "empty"
          : undefined
      }
      // F032 (AS-069): a section linked to a component is tinted with the
      // --component-* tokens, echoing Webflow's green component card.
      // CMS-driven sections take the --cms-* lilac instead, matching the
      // CMS page badge -- and CMS wins when a section is both, because
      // "where does this content come from" is the more load-bearing fact
      // when reading a sitemap than "which component renders it".
      className={cn(
        "group relative w-full rounded-md border bg-card p-3 shadow-xs transition-colors",
        sectionKindAccentClassName(section),
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {isEditing ? (
            <div className="flex min-w-0 flex-col gap-1">
              <Input
                autoFocus
                disabled={isPending}
                value={value}
                onChange={(changeEvent) => {
                  setValue(changeEvent.target.value);
                  if (error) setError(null);
                }}
                onKeyDown={handleKeyDown}
                onBlur={save}
                aria-label="Section name"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "section-name-rename-error" : undefined}
                className="h-7 text-sm"
              />
              {error && (
                <p
                  id="section-name-rename-error"
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {error}
                </p>
              )}
            </div>
          ) : section.component ? (
            // F027 (AS-054, AS-055, AS-056): when a component is linked, its
            // name is the primary label -- the section's own title becomes a
            // secondary "local title" shown underneath in muted text. The
            // local title stays the click-to-edit target so renaming the
            // section (not the component) keeps working exactly as before.
            <>
              {/* F035 (AS-084): clicking the linked component's name opens
                  that component's detail in the components panel. */}
              <button
                type="button"
                onClick={() => onComponentClick?.(section.component!.id)}
                className="block w-full truncate rounded-sm text-left text-sm font-medium hover:bg-muted/50"
              >
                {section.component.name}
              </button>
              {readOnly ? (
                <p className="truncate rounded-sm text-xs text-muted-foreground">
                  {section.title}
                </p>
              ) : (
                <p
                  role="button"
                  tabIndex={0}
                  onClick={startEditing}
                  onKeyDown={(keyEvent) => {
                    if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                      keyEvent.preventDefault();
                      startEditing();
                    }
                  }}
                  className="truncate rounded-sm text-xs text-muted-foreground hover:bg-muted/50"
                >
                  {section.title}
                </p>
              )}
            </>
          ) : readOnly ? (
            <p className="truncate rounded-sm text-sm font-medium">{section.title}</p>
          ) : (
            <p
              role="button"
              tabIndex={0}
              onClick={startEditing}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                  keyEvent.preventDefault();
                  startEditing();
                }
              }}
              className="truncate rounded-sm text-sm font-medium hover:bg-muted/50"
            >
              {section.title}
            </p>
          )}
        </div>
        {section.kind === "cms" && <CmsSectionBadge />}
        {/* F105 (AS-089): gate on `!== undefined` only, not `!== null`. When
            NodeMetaDialog saves it calls `onDetailsInvalidate`, which sets
            `detailsData` to `null` while the board refetches -- gating on
            "not null" unmounted this button for that instant, dumping
            keyboard focus to <body> and remounting a fresh (unfocused)
            button once the refetch resolved. Gating on "not undefined"
            keeps the button mounted through that null interval; it is
            withheld only when the details fetch has genuinely never run
            (the true "unknown" state), matching the original intent of
            F025's comment above without unmounting on every save. */}
        {detailsData !== undefined && nodeMetaCapability && (
          <>
            <button
              type="button"
              aria-label={
                nodeMetaHasContent
                  ? `Edit copy brief for ${section.title}`
                  : `Add copy brief for ${section.title}`
              }
              aria-haspopup="dialog"
              title="Copy brief"
              onClick={() => setMetaOpen(true)}
              className="shrink-0 rounded-md border border-transparent p-1 text-muted-foreground transition-colors hover:border-border-control-hover hover:bg-muted/50 hover:text-foreground"
            >
              <FileText
                className="size-3.5"
                aria-hidden="true"
                fill={nodeMetaHasContent ? "currentColor" : "none"}
                data-node-meta-icon-state={nodeMetaHasContent ? "full" : "empty"}
              />
            </button>
            <NodeMetaDialog
              taskId={section.id}
              taskTitle={section.title}
              meta={nodeMeta}
              open={metaOpen}
              onOpenChange={setMetaOpen}
              onSaved={() => {
                router.refresh();
                onDetailsInvalidate();
              }}
            />
          </>
        )}
        {!readOnly && <SectionCardMenu section={section} components={components} />}
      </div>
    </div>
  );
}
