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
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { PanelRight, PanelRightClose, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useBreadcrumbExtra } from "@/components/nav/breadcrumb-context";
import { useDocAssistant } from "@/lib/ai/use-doc-assistant";
import { getErrorDisplay } from "@/lib/ai/error-display";
import { AssistantThread } from "@/components/ai/assistant-thread";
import { ToolCallList } from "@/components/ai/tool-call-card";
import { AssistantComposer } from "@/components/ai/assistant-composer";
import { ProposalList } from "@/components/ai/proposal-card";
import { useEscapeLayer } from "@/lib/hooks/use-shortcut";

const STORAGE_PREFIX = "pm-app:ai-docs-sidebar-open";

// F036 (minor fold-in): the panel's open/closed state is per-workspace
// (this whole panel is mounted per workspace layout), but the persistence
// key was a single global string — switching workspaces in one tab, or
// having two workspaces open in two tabs, leaked one workspace's
// open/closed choice into the other. Scoped by the workspace slug parsed
// straight off the URL (same `/w/<slug>/...` shape
// `useCurrentDocIdFromPath` below already parses) rather than plumbing
// `workspaceId` down through `AssistantSidebarProvider` in layout.tsx,
// which is outside this feature's Touches.
function useWorkspaceSlugFromPath(): string | null {
  const pathname = usePathname();
  return useMemo(() => {
    if (!pathname) return null;
    const match = pathname.match(/^\/w\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }, [pathname]);
}

/** Below this width the panel is a `fixed` overlay, not a peer panel —
 * see AssistantSidebar's own file-header comment. Mirrors the
 * `max-[1180px]:` Tailwind arbitrary breakpoint used throughout this
 * file, so the JS-side "is this an overlay right now" check and the CSS
 * that actually does the squeeze-vs-float switch never drift apart. */
const OVERLAY_BREAKPOINT_PX = 1180;

/**
 * Tracks whether the panel is CURRENTLY rendered as the <1180px overlay,
 * so Escape/backdrop/focus-trap behaviour (B6) can be scoped to exactly
 * that state and never activate at desktop width, where the panel is a
 * peer panel and trapping focus there would be wrong.
 *
 * Deliberately reads `window.innerWidth` on a `resize` listener rather
 * than `window.matchMedia` — this codebase's jsdom test environment has
 * no `matchMedia` implementation (grepped; no polyfill anywhere else in
 * the suite either), while `window.innerWidth` is real in jsdom (and
 * defaults below 1180, incidentally matching this component's own
 * "renders as an overlay by default" behaviour in tests).
 */
function useIsNarrowOverlayViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.innerWidth <= OVERLAY_BREAKPOINT_PX,
  );

  useEffect(() => {
    function handleResize() {
      setIsNarrow(window.innerWidth <= OVERLAY_BREAKPOINT_PX);
    }
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return isNarrow;
}

type AssistantSidebarContextValue = {
  open: boolean;
  toggle: () => void;
  close: () => void;
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
  const workspaceSlug = useWorkspaceSlugFromPath();
  const storageKey = `${STORAGE_PREFIX}:${workspaceSlug ?? "default"}`;

  useEffect(() => {
    // Same "mounted guard, one synchronous read, no dependencies" escape
    // hatch WhatsNewPanel already uses (components/whats-new/
    // whats-new-panel.tsx) for the identical hydration-mismatch reason —
    // no cascading-render risk since this effect runs exactly once per
    // workspace.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(window.localStorage.getItem(storageKey) === "1");
    } catch {
      // Private browsing / storage disabled: stay closed by default
      // rather than crash the workspace shell.
    }
    // Re-read whenever the workspace changes (navigating between
    // workspaces in the same tab), same rationale as the scoping itself.
  }, [storageKey]);

  function persist(next: boolean) {
    try {
      window.localStorage.setItem(storageKey, next ? "1" : "0");
    } catch {
      // Best-effort persistence only — see file header comment.
    }
  }

  function toggle() {
    setOpen((current) => {
      const next = !current;
      persist(next);
      return next;
    });
  }

  function close() {
    setOpen((current) => {
      if (!current) return current;
      persist(false);
      return false;
    });
  }

  const value = useMemo(
    () => ({ open, toggle, close }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, storageKey],
  );

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
 * F013: the empty state shown before the first message in a thread.
 *
 * Sets expectations plainly (documents-only limit stated up front, before
 * the first refusal has to say it) and offers at least three suggestion
 * chips (AS-068) that are genuinely useful defaults rather than feature
 * advertising — grounded in the currently open doc when there is one.
 * Clicking a chip submits it immediately via the same `send` the composer
 * uses (no intermediate "fill the input then require a second click"
 * step).
 */
function AssistantEmptyState({
  hasDocOpen,
  hasApiKey,
  send,
}: {
  hasDocOpen: boolean;
  /**
   * B3 fix (M2-SCRUTINY.md): the chips used to be neither disabled nor
   * key-aware. Clicking one when there's no API key called `send`, which
   * optimistically appends a user turn — unmounting THIS empty state
   * (and its explanation) since `messages.length !== 0` — only for the
   * route to reject the request and a SECOND, differently-worded
   * "no_api_key" message to render in the composer. Two competing
   * explanations, a phantom turn nobody would ever answer, and no way
   * back. Omitting the chips entirely when there's no key means exactly
   * one explanation is ever on screen (this one), and `send` is never
   * invoked from a state where it can only fail.
   */
  hasApiKey: boolean;
  send: (text: string) => void;
}) {
  const suggestions = hasDocOpen
    ? [
        "What's missing before I send this to the client?",
        "Shorten the introduction",
        "Summarize this doc in three bullet points",
      ]
    : [
        "Draft a new doc from material I'll paste",
        "What docs exist in this workspace?",
        "Help me outline a new doc",
      ];

  return (
    <div
      className="flex flex-col gap-3"
      data-testid="assistant-sidebar-empty-state"
    >
      <p className="text-mini text-muted-foreground">
        This assistant can read and discuss your workspace&apos;s docs, and
        draft new content or edits for you to review. It can&apos;t browse
        the web, access files outside your docs, or take actions without
        your confirmation — it only knows what&apos;s written in this
        workspace&apos;s documents.
      </p>
      {hasApiKey && (
        <div
          className="flex flex-col gap-1.5"
          data-testid="assistant-sidebar-suggestions"
        >
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => send(suggestion)}
              data-testid="assistant-sidebar-suggestion-chip"
              className="rounded-md border border-border px-2.5 py-1.5 text-left text-mini font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
  const { open, close } = useAssistantSidebarContext();
  const currentDocId = useCurrentDocIdFromPath();
  const currentDocTitle = useCurrentDocTitle(currentDocId);
  const isNarrowViewport = useIsNarrowOverlayViewport();
  // F036 (fixes B6): the panel is genuinely a modal overlay ONLY while
  // both true — open, and narrow enough that the CSS above has switched
  // it to `fixed`. At desktop width it's a peer panel: no backdrop, no
  // Escape-to-close, no focus trap, same as AppSidebar never traps focus
  // either.
  const isOverlay = open && isNarrowViewport;

  const panelRef = useRef<HTMLElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // F008: the panel is the first real consumer of this hook.
  // Message/tool/proposal RENDERING is F010-F013's job (see file header)
  // — this call proves the hook wires up correctly and drives the
  // disabled-composer/no-API-key state (AS-071).
  const {
    messages,
    toolCalls,
    proposals,
    isStreaming,
    error,
    usage,
    send,
    stop,
    reset,
    acceptProposal,
    rejectProposal,
  } = useDocAssistant({
    workspaceId,
    currentDocId,
  });

  // F036 (fixes B6): Escape closes the panel, but ONLY while it's
  // actually acting as a modal overlay — registered on the shared
  // escape-layer stack (lib/hooks/use-shortcut.ts) so it cooperates with
  // whatever else may be open instead of a second, competing document
  // keydown listener (same pattern components/task/image-lightbox.tsx
  // uses for the identical reason).
  useEscapeLayer(isOverlay, close);

  // F036 (fixes B6): a focus trap AND initial-focus move, scoped to
  // `isOverlay` exactly like Escape above. Tab/Shift+Tab wrap within the
  // panel's own focusable elements instead of escaping to the header
  // toggle hidden underneath the overlay (or further, to content behind
  // the backdrop).
  useEffect(() => {
    if (!isOverlay) return undefined;

    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const panel = panelRef.current;
    const focusables = panel
      ? Array.from(
          panel.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        )
      : [];
    (focusables[0] ?? panel)?.focus();

    function handleKeyDown(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key !== "Tab") return;
      const current = panelRef.current;
      if (!current) return;
      const elements = Array.from(
        current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (elements.length === 0) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;

      if (keyboardEvent.shiftKey) {
        if (active === first || !current.contains(active)) {
          keyboardEvent.preventDefault();
          last.focus();
        }
      } else if (active === last || !current.contains(active)) {
        keyboardEvent.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [isOverlay]);

  if (!open) return null;

  return (
    <>
      {/* F036 (fixes B6): backdrop, overlay-only. Also the "outside
          click" close affordance — clicking anywhere behind the panel
          closes it, same convention components/task/image-lightbox.tsx
          and components/ui/sheet.tsx already use. */}
      {isOverlay && (
        <div
          className="fixed inset-0 z-30 bg-black/40"
          data-testid="assistant-sidebar-backdrop"
          aria-hidden="true"
          onClick={close}
        />
      )}
      <aside
        ref={panelRef}
        aria-label="Docs assistant"
        data-testid="assistant-sidebar"
        role={isOverlay ? "dialog" : undefined}
        aria-modal={isOverlay ? "true" : undefined}
        tabIndex={-1}
        className={cn(
          "flex w-[380px] min-h-0 shrink-0 flex-col rounded-lg border border-border bg-background m-2 outline-none",
          // Below ~1180px: overlay instead of squeeze (see file header
          // comment). `fixed` takes it out of the flex row entirely, so
          // the content panel reclaims the width it would otherwise lose.
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
            // label `--text-quaternary` is for. That token has no
            // Tailwind utility wired up in this codebase yet (grepped;
            // absent from app/globals.css's @theme block), so
            // `text-muted-foreground` is used instead rather than
            // inventing a new class — see handoff for the follow-up to
            // wire the token properly.
            <span
              className="shrink-0 text-micro text-muted-foreground"
              data-testid="assistant-sidebar-no-doc-hint"
            >
              No doc open
            </span>
          )}
          {/* F036 (fixes B3's "no way back"): `reset` exists on
              useDocAssistant but was never destructured here. Exposed as
              a quiet affordance whenever there's a thread to clear —
              covers the no-key dead-end (a stray turn from before this
              fix, or any future one) as well as an ordinary "start
              over". */}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              data-testid="assistant-sidebar-reset"
              className="shrink-0 rounded-md px-1.5 py-1 text-micro font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              New conversation
            </button>
          )}
          {/* F036 (fixes B6): the only way to reach the toggle was the
              header button UNDERNEATH this overlay — genuinely
              unreachable below 1180px. Overlay-only; at desktop width
              the header toggle is already right there and a second
              close control would be redundant on a non-modal peer
              panel. */}
          <button
            type="button"
            onClick={close}
            aria-label="Close docs assistant"
            data-testid="assistant-sidebar-close"
            className="hidden shrink-0 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 max-[1180px]:flex"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Thread region — message rendering is F010's job. F036 (fixes
            B5): this used to be an unshrinkable-siblings-of-nothing
            layout with NO `overflow` class despite a comment claiming an
            "independent scroll region" — `ToolCallList` and the error
            `<p>` overflowed the whole `aside`. Both now render INSIDE
            `AssistantThread`'s own scroll container (its `trailing`
            prop) so there is exactly one scroll region, and this
            wrapper additionally gets its own `overflow-y-auto` as a
            second line of defence for the empty-state branch (chips +
            explanation), which never mounts `AssistantThread` at all. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
          {messages.length === 0 ? (
            // F013: the real empty state (copy + suggestion chips).
            <AssistantEmptyState
              hasDocOpen={Boolean(currentDocId)}
              hasApiKey={hasApiKey}
              send={send}
            />
          ) : (
            // F010: message rendering (bubbles + markdown + considerate
            // auto-scroll) — see components/ai/assistant-thread.tsx.
            <AssistantThread
              messages={messages}
              trailing={
                <>
                  {/* F011: quiet, collapsible cards for auditing tool
                      calls. Renders nothing when there are no tool calls
                      yet. */}
                  <ToolCallList toolCalls={toolCalls} />

                  {/* F015/F016: proposal cards — renders nothing when
                      there are no proposals yet. Lives inside
                      AssistantThread's own scroll container for the same
                      "exactly one scroll region" reason ToolCallList
                      does (see this block's own F036 comment above). */}
                  <ProposalList
                    proposals={proposals}
                    workspaceId={workspaceId}
                    onAccept={acceptProposal}
                    onReject={rejectProposal}
                  />

                  {error &&
                    (() => {
                      // F020: every `error` code renders as a human
                      // sentence. `no_api_key` is a configuration state,
                      // not a failure — it gets neutral styling (no red/
                      // amber), everything else (rate_limit, thread_limit,
                      // auth_error, model_error, and any unrecognised
                      // code) gets the warning treatment.
                      const display = getErrorDisplay(error);
                      return (
                        <p
                          className={cn(
                            "rounded-md px-2 py-1.5 text-mini",
                            display.tone === "neutral"
                              ? "bg-muted text-muted-foreground"
                              : "bg-status-waiting-bg text-status-waiting",
                          )}
                          data-testid="assistant-sidebar-error"
                          data-error-tone={display.tone}
                        >
                          {display.message}
                        </p>
                      );
                    })()}
                </>
              }
            />
          )}
        </div>

        {/* Composer — F012: real input/send/stop wiring, plus the
            AS-071 no-API-key message (this component owns that whole
            region now; see components/ai/assistant-composer.tsx's own
            header comment). */}
        <div className="shrink-0 border-t border-border p-3">
          <AssistantComposer
            hasApiKey={hasApiKey}
            isStreaming={isStreaming}
            send={send}
            stop={stop}
            usage={usage}
          />
        </div>
      </aside>
    </>
  );
}
