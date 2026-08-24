"use client";

// F229 (AS-429, AS-431, AS-432): the list page's saved-view picker.
// Server-fetched `views` (lib/queries/views.ts's listSavedViewsForProject
// — RLS-scoped, so this component never receives a view it shouldn't) are
// passed down as typed props per the clarified data-shape answer; this
// component is purely the interactive Client Component boundary —
// selecting a view navigates to `?viewId=<id>` (AS-432's shareable URL:
// the list page reads that param server-side and applies the view's
// config), and "Copy link" copies that same URL to the clipboard so
// another member can open the exact same result.

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Check, ChevronsUpDown, Link as LinkIcon, Star, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { setDefaultSavedView, deleteSavedView } from "@/lib/actions/views";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SavedViewListItem } from "@/lib/queries/views";

export function ViewSwitcher({
  views,
  activeViewId,
}: {
  views: SavedViewListItem[];
  activeViewId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const mine = views.filter((view) => view.isMine);
  const shared = views.filter((view) => !view.isMine);
  const active = views.find((view) => view.id === activeViewId);

  function openView(viewId: string) {
    const params = new URLSearchParams();
    params.set("viewId", viewId);
    router.push(`${pathname}?${params.toString()}`);
  }

  function clearView() {
    router.push(pathname);
  }

  function copyLink(viewId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("viewId", viewId);
    const url = `${window.location.origin}${pathname}?${params.toString()}`;
    navigator.clipboard
      .writeText(url)
      .then(() => toast.success("Link copied — anyone with access to this project can open it."))
      .catch(() => toast.error("Couldn't copy the link."));
  }

  function makeDefault(viewId: string) {
    startTransition(async () => {
      const result = await setDefaultSavedView(viewId);
      if (result.ok) {
        toast.success("Set as your default view for this project.");
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function removeView(viewId: string) {
    startTransition(async () => {
      const result = await deleteSavedView(viewId);
      if (result.ok) {
        toast.success("View deleted.");
        if (viewId === activeViewId) {
          clearView();
        } else {
          router.refresh();
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button type="button" variant="outline" size="sm" className="gap-1.5">
            {isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            <span className="max-w-40 truncate">{active ? active.name : "Views"}</span>
            <ChevronsUpDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        {views.length === 0 && (
          <div className="px-2 py-3 text-sm text-muted-foreground">
            No saved views yet. Set your filters, then use &quot;Save view&quot; to
            save your first one.
          </div>
        )}

        {mine.length > 0 && (
          <>
            <DropdownMenuLabel>Your views</DropdownMenuLabel>
            {mine.map((view) => (
              <ViewMenuRow
                key={view.id}
                view={view}
                active={view.id === activeViewId}
                onOpen={() => openView(view.id)}
                onCopyLink={() => copyLink(view.id)}
                onMakeDefault={() => makeDefault(view.id)}
                onDelete={() => removeView(view.id)}
              />
            ))}
          </>
        )}

        {shared.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Shared with you</DropdownMenuLabel>
            {shared.map((view) => (
              <ViewMenuRow
                key={view.id}
                view={view}
                active={view.id === activeViewId}
                onOpen={() => openView(view.id)}
                onCopyLink={() => copyLink(view.id)}
              />
            ))}
          </>
        )}

        {activeViewId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={clearView}>Clear applied view</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewMenuRow({
  view,
  active,
  onOpen,
  onCopyLink,
  onMakeDefault,
  onDelete,
}: {
  view: SavedViewListItem;
  active: boolean;
  onOpen: () => void;
  onCopyLink: () => void;
  onMakeDefault?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-1">
      <DropdownMenuItem
        onClick={onOpen}
        className="flex-1 justify-between gap-2"
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate">
          {active && <Check className="size-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{view.name}</span>
          {view.isDefault && (
            <Star
              className="size-3 shrink-0 fill-current text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </span>
      </DropdownMenuItem>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={`Copy link to "${view.name}"`}
        title="Copy shareable link"
        onClick={(event) => {
          event.stopPropagation();
          onCopyLink();
        }}
      >
        <LinkIcon className="size-3.5" aria-hidden="true" />
      </Button>
      {onMakeDefault && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={`Set "${view.name}" as your default`}
          title={view.isDefault ? "Your default view" : "Set as your default view"}
          disabled={view.isDefault}
          onClick={(event) => {
            event.stopPropagation();
            onMakeDefault();
          }}
        >
          <Star
            className={`size-3.5 ${view.isDefault ? "fill-current" : ""}`}
            aria-hidden="true"
          />
        </Button>
      )}
      {onDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
          aria-label={`Delete "${view.name}"`}
          title="Delete view"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          ×
        </Button>
      )}
    </div>
  );
}
