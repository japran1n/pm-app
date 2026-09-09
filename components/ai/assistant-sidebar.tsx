"use client";

// F009: the docs assistant sidebar shell. Docked right of the existing
// raised content panel (see app/(workspace)/w/[workspaceSlug]/layout.tsx's
// own comment on why this mounts as a SIBLING panel in the same
// `flex h-svh` row, not inside WorkspaceMain) and toggled from the
// workspace top bar (components/nav/app-header.tsx, next to HeaderSearch).
//
// This single file exports everything F009 needs to wire the toggle
// (mounted in the header, deep in WorkspaceMain's subtree) and the panel
// itself (mounted as AppSidebar's mirror, one level up in layout.tsx)
// without prop-drilling shared open/closed state through every
// intermediate layer: a small context, the same shape as
// BreadcrumbProvider/MembershipProvider already established in this
// codebase, owns just that one boolean.
//
// Out of scope here (per spec): message rendering (F010), tool cards
// (F011), composer internals (F012), empty state (F013) — this file
// renders labelled placeholder regions for each and wires the real
// `useDocAssistant` hook (F008) only far enough to prove the panel's
// context bar and disabled-composer states work end to end.

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { PanelRight, PanelRightClose } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useBreadcrumbExtra } from "@/components/nav/breadcrumb-context";
import { useDocAssistant } from "@/lib/ai/use-doc-assistant";
import { AssistantThread } from "@/components/ai/assistant-thread";
import { ToolCallList } from "@/components/ai/tool-call-card";

const STORAGE_KEY = "pm-app:ai-docs-sidebar-open";

type AssistantSidebarContextValue = {
  open: boolean;
  toggle: () => void;
};

const AssistantSidebarContext =
  createContext<AssistantSidebarContextValue | null>(null);

/**
 * Owns the open/closed boolean shared between `AssistantSidebarToggle`
 * (header) and `AssistantSidebar` (layout panel). Persisted to
 * localStorage, restored on mount.
 *
 * AS-060: state must survive a reload. `localStorage` access is wrapped in
 * try/catch throughout — private browsing (Safari in particular) throws on
 * `localStorage.getItem`/`setItem` rather than just no-opping, and an
 * unhandled throw here would blank the entire workspace since this
 * provider wraps the whole `<div className="flex h-svh">` row.
 *
 * Same "start at the server default, flip in an effect after mount" shape
 * WhatsNewPanel already uses (components/whats-new/whats-new-panel.tsx)
 * to avoid an SSR/CSR hydration mismatch: the server never has
 * localStorage, so both the server render and the first client render
 * must agree on `false` (closed) before the real, possibly-`true` value is
 * read.
 */
export function AssistantSidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Same "mounted guard, one synchronous read, no dependencies" escape
    // hatch WhatsNewPanel already uses (components/whats-new/
    // whats-new-panel.tsx) for the identical hydration-mismatch reason —
    // no cascading-render risk since this effect runs exactly once.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private browsing / storage disabled: stay closed by default
      // rather than crash the workspace shell.
    }
  }, []);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Best-effort persistence only — see file header comment.
      }
      return next;
    });
  }

  const value = useMemo(() => ({ open, toggle }), [open]);

  return (
    <AssistantSidebarContext.Provider value={value}>
      {children}
    </AssistantSidebarContext.Provider>
  );
}

function useAssistantSidebarContext(): AssistantSidebarContextValue {
  const ctx = useContext(AssistantSidebarContext);
  if (!ctx) {
    throw new Error(
      "useAssistantSidebarContext must be used within an AssistantSidebarProvider",
    );
  }
  return ctx;
}

/**
 * Header toggle button. Mounted in components/nav/app-header.tsx next to
 * HeaderSearch — same `variant="ghost" size="icon"` treatment (and hover
 * fill) as every other icon trigger already in that header
 * (GlobalTimeTracker, WhatsNewPanel), so it reads as one of that row's
 * existing controls rather than a bolted-on new pattern.
 */
export function AssistantSidebarToggle() {
  const { open, toggle } = useAssistantSidebarContext();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={open ? "Close docs assistant" : "Open docs assistant"}
      aria-pressed={open}
      data-testid="assistant-sidebar-toggle"
      onClick={toggle}
    >
      {open ? (
        <PanelRightClose className="size-4" aria-hidden="true" />
      ) : (
        <PanelRight className="size-4" aria-hidden="true" />
      )}
    </Button>
  );
}

/**
 * Extracts the currently-open doc's id from the URL. Both doc routes this
 * app has end in `/docs/<docId>` — `/w/[slug]/docs/[docId]` and
 * `/w/[slug]/projects/[projectId]/docs/[docId]` (see
 * app/(workspace)/w/[workspaceSlug]/docs/[docId]/page.tsx and the
 * project-scoped sibling) — so a single trailing-segment match covers
 * both without knowing which one the caller is on. Returns null on any
 * other route (docs LIST pages, non-docs pages).
 */
function useCurrentDocIdFromPath(): string | null {
  const pathname = usePathname();
  return useMemo(() => {
    if (!pathname) return null;
    const match = pathname.match(/\/docs\/([^/]+)$/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
}

/**
 * The panel's context bar title. BreadcrumbProvider
 * (components/nav/breadcrumb-context.tsx) already exists for exactly this
 * "leaf announces itself upward" shape — the doc editor
 * (components/docs/markdown-editor.tsx) calls `useSetBreadcrumb([{ label:
 * title }])` (added alongside this feature) whenever its title changes, so
 * this reads the SAME context ProjectBreadcrumb already populates for
 * projects, rather than adding a second provider or re-fetching the doc.
 *
 * AS-061: this recomputes on every render, so navigating from doc A to
 * doc B updates the title WITHOUT touching `useDocAssistant`'s own state
 * (messages/thread) — the two are fully decoupled, satisfying "updates ...
 * without losing the thread".
 */
function useCurrentDocTitle(docId: string | null): string | null {
  const extra = useBreadcrumbExtra();
  return useMemo(() => {
    if (!docId || extra.length === 0) return null;
    return extra[extra.length - 1]?.label ?? null;
  }, [docId, extra]);
}

/**
 * The panel itself. Mounted in layout.tsx as a sibling of the existing
 * `bg-background border border-border rounded-lg m-2` content panel,
 * inside the same `flex h-svh` row — see this feature's "RESOLVED BY
 * ORCHESTRATOR" note in the spec for why (mirrors AppSidebar's left-side
 * relationship; keeps the zero-shadow rule intact since elevation here
 * comes from the panel structure, not a floating overlay).
 *
 * Below ~1180px this same treatment would visually squeeze the content
 * panel to the point of being unusable, so past that breakpoint the panel
 * switches to `fixed` positioning and floats over the content instead —
 * at that point it genuinely IS an overlay, which is why it's the one
 * place in this component that takes a shadow (the shadow rule's
 * documented overlay exemption; dropdown/popover/dialog/sheet/command/
 * tooltip get the same treatment for the same reason).
 */
export function AssistantSidebar({
  workspaceId,
  hasApiKey,
}: {
  workspaceId: string;
  hasApiKey: boolean;
}) {
  const { open } = useAssistantSidebarContext();
  const currentDocId = useCurrentDocIdFromPath();
  const currentDocTitle = useCurrentDocTitle(currentDocId);

  // F008: the panel is the first real consumer of this hook.
  // Message/tool/proposal RENDERING is F010-F013's job (see file header)
  // — this call proves the hook wires up correctly and drives the
  // disabled-composer/no-API-key state (AS-071).
  const { messages, toolCalls, isStreaming, error } = useDocAssistant({
    workspaceId,
    currentDocId,
  });

  if (!open) return null;

  return (
    <aside
      aria-label="Docs assistant"
      data-testid="assistant-sidebar"
      className={cn(
        "flex w-[380px] min-h-0 shrink-0 flex-col rounded-lg border border-border bg-background m-2",
        // Below ~1180px: overlay instead of squeeze (see file header
        // comment). `fixed` takes it out of the flex row entirely, so the
        // content panel reclaims the width it would otherwise lose.
        "max-[1180px]:fixed max-[1180px]:inset-y-2 max-[1180px]:right-2 max-[1180px]:z-40 max-[1180px]:m-0 max-[1180px]:shadow-lg",
      )}
    >
      {/* Context bar (AS-061): the currently open doc's title, or a
          decorative placeholder when no doc is open. */}
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate text-mini font-semibold text-foreground">
          {currentDocTitle ?? "Assistant"}
        </span>
        {!currentDocId && (
          // Decorative only (never the sole way to learn "no doc is
          // open" — the composer/thread placeholders below already say
          // so in operational copy), so this is exactly the kind of
          // label `--text-quaternary` is for. That token has no Tailwind
          // utility wired up in this codebase yet (grepped; absent from
          // app/globals.css's @theme block), so `text-muted-foreground`
          // is used instead rather than inventing a new class — see
          // handoff for the follow-up to wire the token properly.
          <span
            className="shrink-0 text-micro text-muted-foreground"
            data-testid="assistant-sidebar-no-doc-hint"
          >
            No doc open
          </span>
        )}
      </div>

      {/* Thread region — message rendering is F010's job (placeholder
          here proves the hook's `messages` state actually reaches this
          panel). Independent scroll region per the mount-point note: this
          must never inherit page-level scroll from WorkspaceMain. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
        {messages.length === 0 ? (
          // F013 owns the real empty state; this is a structural
          // placeholder so the region is never blank/undefined-looking
          // before that feature lands.
          <p
            className="text-mini text-muted-foreground"
            data-testid="assistant-sidebar-thread-placeholder"
          >
            Ask the assistant about this workspace&apos;s docs.
          </p>
        ) : (
          // F010: message rendering (bubbles + markdown + considerate
          // auto-scroll) — see components/ai/assistant-thread.tsx.
          <AssistantThread messages={messages} />
        )}

        {/* F011: quiet, collapsible cards for auditing tool calls.
            Renders nothing when there are no tool calls yet. */}
        <ToolCallList toolCalls={toolCalls} />

        {error && (
          <p
            className="rounded-md bg-status-waiting-bg px-2 py-1.5 text-mini text-status-waiting"
            data-testid="assistant-sidebar-error"
          >
            {error.message}
          </p>
        )}
      </div>

      {/* Composer — real input/send/stop wiring is F012's job. This
          region only owns the AS-071 disabled/no-API-key state, since that
          state gates the whole composer regardless of which feature wires
          the rest of it. */}
      <div className="shrink-0 border-t border-border p-3">
        {hasApiKey ? (
          <div
            className="rounded-md border border-border px-2.5 py-2 text-mini text-muted-foreground"
            data-testid="assistant-sidebar-composer-placeholder"
          >
            {isStreaming ? "Assistant is responding…" : "Composer (F012)"}
          </div>
        ) : (
          // AS-071: a configuration state, not an error — no
          // destructive/red styling. Uses the same neutral
          // muted/muted-foreground pair the spec's token table assigns to
          // "rejected / settled-neutral", which is exactly the register
          // this message needs: calm, not alarming.
          <div
            className="rounded-md bg-muted px-2.5 py-2 text-mini text-muted-foreground"
            data-testid="assistant-sidebar-no-api-key"
          >
            The docs assistant isn&apos;t configured for this environment yet
            — an administrator needs to set an API key before it can
            respond.
          </div>
        )}
      </div>
    </aside>
  );
}
