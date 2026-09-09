"use client";

// F008: client-side stream parser for the docs sidebar's AI assistant. This
// hook owns nothing but in-memory React state — no persistence, no direct
// Supabase access, no rendering decisions (F010/F011 own those). It POSTs
// to app/api/ai/docs/route.ts (F007 + remediation F023-F032) and turns the
// NDJSON event stream that route emits into `messages` / `toolCalls` /
// `proposals` / `isStreaming` / `error`.
//
// Event envelope this hook parses (verbatim from the route's own `send(...)`
// calls, NOT the (stale) table in tech-decisions.md):
//   {"t":"text","v":"..."}
//   {"t":"tool_start","id":"...","name":"...","args"?:"..."}
//   {"t":"tool_end","id":"...","summary":"...","detail"?:"..."}
//   {"t":"proposal","id":"...","kind":"doc_edit"|"doc_create","payload":{...}}
//   {"t":"usage","in":123,"out":456,"cached":789}
//   {"t":"error","code":"...","message":"..."}
//   {"t":"done"}
// Unknown `t` values are ignored rather than thrown on — the envelope is
// expected to grow in M3.
import { useCallback, useEffect, useRef, useState } from "react";

import {
  addMessage,
  createThread,
  getRecentThread,
  updateProposalState,
} from "@/lib/actions/ai-threads";
import { logger } from "@/lib/observability/logger";
import type { Json } from "@/lib/supabase/database.types";

// F034: caps mirrored from app/api/ai/docs/route.ts's `MAX_HISTORY_TURNS`.
// The route is the source of truth and re-enforces this server-side — this
// client-side trim only avoids sending a request the route would reject
// outright, and keeps the outgoing payload bounded.
const MAX_HISTORY_TURNS = 20;

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface ToolCallView {
  id: string;
  name: string;
  status: "running" | "done";
  // F033: a sanitised, length-bounded summary of the tool's (model-
  // controlled) arguments, carried on tool_start and rendered alongside
  // `detail` in the expanded panel. Server-sanitised before it ever
  // reaches this hook — same treatment as `detail` (see
  // components/ai/tool-call-card.tsx's header comment).
  args?: string;
  summary?: string;
  detail?: string;
}

export interface ProposalView {
  id: string;
  kind: "doc_edit" | "doc_create";
  payload: unknown;
  status: "pending" | "accepted" | "rejected";
}

export interface AssistantError {
  code: string;
  message: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

interface UseDocAssistantOptions {
  workspaceId: string;
  currentDocId?: string | null;
}

interface UseDocAssistantResult {
  messages: AssistantMessage[];
  toolCalls: ToolCallView[];
  proposals: ProposalView[];
  isStreaming: boolean;
  error: AssistantError | null;
  usage: UsageTotals | null;
  send: (text: string) => void;
  stop: () => void;
  reset: () => void;
  /**
   * F015/F016: marks a pending proposal `accepted` in this hook's own
   * state. This function performs NO writes itself — it is called by
   * `ProposalCard` (components/ai/proposal-card.tsx) only AFTER F016's
   * server action (`applyDocEditProposal`) has already resolved
   * successfully. This hook has no knowledge of `updateDoc`/Supabase and
   * must stay that way; it is a pure in-memory state container.
   */
  acceptProposal: (id: string) => void;
  /**
   * F015: marks a pending proposal `rejected`. Reject performs zero calls
   * anywhere (AS-010) — this is a plain state transition, nothing else.
   */
  rejectProposal: (id: string) => void;
}

/** Narrows a hydrated `ai_messages.role` column value into this hook's
 * stricter union — anything unrecognised (there shouldn't be any, per the
 * migration's own check, but the DB column is a plain `string`) falls back
 * to "user" rather than crashing hydration. */
function toMessageRole(role: string): "user" | "assistant" {
  return role === "assistant" ? "assistant" : "user";
}

/** A hydrated message's `tool_calls`/`proposals` JSONB columns are typed as
 * `Json | null` by the generated types — narrows to the array shape this
 * hook actually stored there (via `addMessage`), or `[]` for anything else
 * (null, a stray non-array value). */
function toArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

type NdjsonEvent =
  | { t: "text"; v: string }
  | { t: "tool_start"; id: string; name: string; args?: string }
  | { t: "tool_end"; id: string; summary: string; detail?: string }
  | {
      t: "proposal";
      id: string;
      kind: "doc_edit" | "doc_create";
      payload: unknown;
    }
  | { t: "usage"; in: number; out: number; cached: number }
  | { t: "error"; code: string; message: string }
  | { t: "done" }
  // Forward-compat: any other shape is a valid, ignorable event.
  | { t: string; [key: string]: unknown };

/** Generates a locally-unique id for a client-created message turn. */
function makeLocalId(): string {
  return `local_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

/**
 * Parses one already-trimmed, non-empty NDJSON line into an event, or
 * returns null for a line that isn't valid JSON (defensive — the server
 * only ever writes well-formed lines, but a truncated final chunk on
 * abort/network-drop could leave a non-JSON fragment behind).
 */
function parseLine(line: string): NdjsonEvent | null {
  try {
    return JSON.parse(line) as NdjsonEvent;
  } catch {
    return null;
  }
}

export function useDocAssistant({
  workspaceId,
  currentDocId,
}: UseDocAssistantOptions): UseDocAssistantResult {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [toolCalls, setToolCalls] = useState<ToolCallView[]>([]);
  const [proposals, setProposals] = useState<ProposalView[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<AssistantError | null>(null);
  const [usage, setUsage] = useState<UsageTotals | null>(null);

  // Kept in sync via the effect below.

  const abortControllerRef = useRef<AbortController | null>(null);
  // Tracks the id of the assistant message currently receiving `text`
  // deltas, so consecutive deltas append to the same message rather than
  // each creating a new one.
  const openAssistantIdRef = useRef<string | null>(null);
  // F034: mirrors `messages` synchronously (state updates are async) so
  // `send()` can read the conversation-as-of-now to build the history
  // payload without depending on `messages` as a callback dependency
  // (which would recreate `send` — and therefore any consumer's memoised
  // handlers — on every delta).
  const messagesRef = useRef<AssistantMessage[]>([]);
  // F020: mirrors `usage` synchronously so `send()` can report this
  // thread's cumulative token total to the route's token-ceiling guard
  // without depending on `usage` as a callback dependency.
  const usageRef = useRef<UsageTotals | null>(null);
  // F034: guards the unmount race — an in-flight turn's `finally` block
  // must not call `setIsStreaming` after the component has unmounted.
  const mountedRef = useRef(true);

  // F019: the persisted thread this conversation is (or will become) rows
  // under. `null` means "no thread yet" — either a fresh mount with no
  // prior thread, or `reset()`'s "New chat" (AS-083): the NEXT `send()`
  // creates a brand new `ai_threads` row rather than reusing the old one.
  // A plain ref, not state — nothing renders off this value directly.
  const threadIdRef = useRef<string | null>(null);
  // F019: maps a proposal's id to the thread/message row it was persisted
  // under, populated once that turn's `addMessage` call resolves (or by
  // hydration on mount). `acceptProposal`/`rejectProposal` consult this to
  // call `updateProposalState` — a proposal accepted/rejected before its
  // owning message has finished persisting (a very fast click) simply
  // isn't in this map yet and the persistence call is skipped for it; the
  // in-memory state transition (the part the UI depends on) still happens
  // either way.
  const proposalLocationRef = useRef<Map<string, { threadId: string; messageId: string }>>(
    new Map(),
  );
  // F019: whether hydration has already run for the current mount, so the
  // mount effect below never double-fires (e.g. React StrictMode's
  // double-invoke in dev) and clobbers a conversation already in progress.
  const hydratedRef = useRef(false);

  // F034: every event application is scoped to the controller of the turn
  // that produced it. A stale stream (from a superseded send(), a stop(),
  // or a reset()) must never mutate state after its controller has been
  // aborted — otherwise a settled/cleared conversation can be silently
  // resurrected by a late-arriving chunk.
  const applyEvent = useCallback((event: NdjsonEvent, controller: AbortController) => {
    if (controller.signal.aborted) return;
    switch (event.t) {
      case "text": {
        const delta = (event as Extract<NdjsonEvent, { t: "text" }>).v;
        setMessages((prev) => {
          const openId = openAssistantIdRef.current;
          if (openId) {
            const idx = prev.findIndex((m) => m.id === openId);
            if (idx !== -1) {
              const next = [...prev];
              next[idx] = { ...next[idx], text: next[idx].text + delta };
              return next;
            }
          }
          // No open assistant message yet — start one.
          const id = makeLocalId();
          openAssistantIdRef.current = id;
          return [...prev, { id, role: "assistant", text: delta }];
        });
        return;
      }
      case "tool_start": {
        const { id, name, args } = event as Extract<NdjsonEvent, { t: "tool_start" }>;
        setToolCalls((prev) => {
          const idx = prev.findIndex((tc) => tc.id === id);
          if (idx !== -1) {
            // Guard against a `tool_start` arriving after this call's own
            // `tool_end` (out-of-order delivery) — never regress a
            // finished call back into a permanent spinner.
            if (prev[idx].status === "done") return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], name, args, status: "running" };
            return next;
          }
          return [...prev, { id, name, args, status: "running" as const }];
        });
        return;
      }
      case "tool_end": {
        const { id, summary, detail } = event as Extract<
          NdjsonEvent,
          { t: "tool_end" }
        >;
        setToolCalls((prev) => {
          const idx = prev.findIndex((tc) => tc.id === id);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...next[idx], status: "done", summary, detail };
            return next;
          }
          // tool_end without a matching tool_start seen yet — still
          // record it rather than dropping the data.
          return [...prev, { id, name: "", status: "done" as const, summary, detail }];
        });
        return;
      }
      case "proposal": {
        const { id, kind, payload } = event as Extract<
          NdjsonEvent,
          { t: "proposal" }
        >;
        setProposals((prev) => {
          const idx = prev.findIndex((p) => p.id === id);
          const entry: ProposalView = { id, kind, payload, status: "pending" };
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = entry;
            return next;
          }
          return [...prev, entry];
        });
        return;
      }
      case "error": {
        const { code, message } = event as Extract<NdjsonEvent, { t: "error" }>;
        // Populate error without discarding text already received.
        setError({ code, message });
        return;
      }
      case "usage": {
        const { in: inTokens, out: outTokens, cached } = event as Extract<
          NdjsonEvent,
          { t: "usage" }
        >;
        // Accumulate across turns in the same thread (a running total),
        // not a per-turn replacement — matches the meta row's "running
        // token count" framing.
        setUsage((prev) => ({
          inputTokens: (prev?.inputTokens ?? 0) + (inTokens ?? 0),
          outputTokens: (prev?.outputTokens ?? 0) + (outTokens ?? 0),
          cachedTokens: (prev?.cachedTokens ?? 0) + (cached ?? 0),
        }));
        return;
      }
      case "done":
        return;
      default:
        // Unknown event shape — ignore for forward compatibility.
        return;
    }
  }, []);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      // Abort any in-flight turn before starting a new one.
      abortControllerRef.current?.abort();

      const controller = new AbortController();
      abortControllerRef.current = controller;
      openAssistantIdRef.current = null;
      setError(null);
      setIsStreaming(true);

      const userMessage: AssistantMessage = {
        id: makeLocalId(),
        role: "user",
        text: trimmed,
      };

      // F034/F028: build the history payload from the conversation as it
      // stands *before* this turn's user message is appended locally —
      // the route's `messages` field is "prior turns", not including the
      // one just sent as `message`. Trimmed to the route's own
      // MAX_HISTORY_TURNS so a long-running conversation never grows the
      // outgoing payload unbounded.
      const historyTurns = messagesRef.current
        .filter((m) => m.text.trim().length > 0)
        .map((m) => ({ role: m.role, content: m.text }))
        .slice(-MAX_HISTORY_TURNS);

      // F019: this turn's own accumulators, updated synchronously (by
      // recordTurnEvent below) alongside — but INDEPENDENTLY of —
      // applyEvent's React state updates. Deliberately NOT read off
      // toolCalls/proposals state (or a ref synced from them via
      // useEffect): passive effects flush on their own schedule, which can
      // lag well behind a stream that resolves multiple NDJSON lines
      // across consecutive microtask-resolved reader.read() calls with no
      // macrotask yield in between — reading state (or an effect-synced
      // ref) for persistence immediately after the loop ends is not
      // reliably caught up by then. These plain closures, updated inline
      // as each event is parsed, have no such lag.
      let turnText = "";
      const turnToolCallsMap = new Map<string, ToolCallView>();
      const turnProposalsMap = new Map<string, ProposalView>();
      let turnUsage: UsageTotals | null = null;

      function recordTurnEvent(event: NdjsonEvent) {
        switch (event.t) {
          case "text": {
            turnText += (event as Extract<NdjsonEvent, { t: "text" }>).v;
            return;
          }
          case "tool_start": {
            const { id, name, args } = event as Extract<NdjsonEvent, { t: "tool_start" }>;
            const existing = turnToolCallsMap.get(id);
            if (existing?.status === "done") return;
            turnToolCallsMap.set(id, { ...existing, id, name, args, status: "running" });
            return;
          }
          case "tool_end": {
            const { id, summary, detail } = event as Extract<NdjsonEvent, { t: "tool_end" }>;
            const existing = turnToolCallsMap.get(id);
            turnToolCallsMap.set(id, {
              id,
              name: existing?.name ?? "",
              status: "done",
              summary,
              detail,
            });
            return;
          }
          case "proposal": {
            const { id, kind, payload } = event as Extract<NdjsonEvent, { t: "proposal" }>;
            turnProposalsMap.set(id, { id, kind, payload, status: "pending" });
            return;
          }
          case "usage": {
            const { in: inTokens, out: outTokens, cached } = event as Extract<
              NdjsonEvent,
              { t: "usage" }
            >;
            turnUsage = {
              inputTokens: (turnUsage?.inputTokens ?? 0) + (inTokens ?? 0),
              outputTokens: (turnUsage?.outputTokens ?? 0) + (outTokens ?? 0),
              cachedTokens: (turnUsage?.cachedTokens ?? 0) + (cached ?? 0),
            };
            return;
          }
          default:
            return;
        }
      }

      setMessages((prev) => [...prev, userMessage]);

      // F019: ensures a thread row exists for this conversation (creating
      // one, titled from THIS turn's text, the first time a message is
      // ever sent — AS-083's "New chat" works by threadIdRef having been
      // nulled out already) and persists this turn's user message onto
      // it. Deliberately NOT awaited before the fetch below starts — the
      // live conversation must never block on persistence — but IS
      // awaited by the assistant-turn persistence at the end of this
      // turn, so the assistant row always has a real thread to belong to
      // once the thread creation call has had a chance to resolve.
      const threadPromise: Promise<string | null> = (async () => {
        try {
          let threadId = threadIdRef.current;
          if (!threadId) {
            const created = await createThread(workspaceId, currentDocId ?? null, null, trimmed);
            if ("error" in created) {
              logger.error("useDocAssistant: createThread failed", { error: created.error });
              return null;
            }
            threadId = created.id;
            threadIdRef.current = threadId;
          }
          const added = await addMessage(threadId, "user", trimmed, null, null, null);
          if ("error" in added) {
            logger.error("useDocAssistant: addMessage(user) failed", { error: added.error });
          }
          return threadId;
        } catch (persistErr) {
          logger.error("useDocAssistant: user-turn persistence threw", { error: persistErr });
          return threadIdRef.current;
        }
      })();
      // Persistence failures must never surface as a chat-breaking error —
      // this codebase's convention (see ai-proposals.ts, docs.ts) is to
      // log and continue; the in-memory conversation stays fully usable
      // even when every persistence call in this turn fails. The IIFE
      // above already catches internally, so `threadPromise` itself never
      // rejects — it is `await`ed (not just fired-and-forgotten) by the
      // assistant-turn persistence in this turn's `finally` block below.

      void (async () => {
        try {
          const response = await fetch("/api/ai/docs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId,
              message: trimmed,
              // Omit currentDocId entirely rather than send a non-uuid
              // placeholder — the route validates it as a strict uuid.
              ...(currentDocId ? { currentDocId } : {}),
              ...(historyTurns.length > 0 ? { messages: historyTurns } : {}),
              // F020: this thread's running token total so far, for the
              // route's per-thread ceiling guard (checkTokenCeiling).
              ...(usageRef.current
                ? { threadUsage: usageRef.current.inputTokens + usageRef.current.outputTokens }
                : {}),
            }),
            signal: controller.signal,
          });

          if (!response.ok) {
            // F034: surface the route's real error message (401/400/403
            // each say something different) instead of one opaque string
            // — session expiry must be distinguishable from a bug.
            let serverMessage: string | null = null;
            try {
              const payload = (await response.json()) as { error?: unknown };
              if (typeof payload?.error === "string" && payload.error.trim()) {
                serverMessage = payload.error;
              }
            } catch {
              // Non-JSON or unreadable body — fall back to a generic message.
            } finally {
              // Cancel the body if reading it above didn't already fully
              // consume/lock it (some environments still hand back a
              // readable body after a failed .json() parse attempt).
              void response.body?.cancel().catch(() => {});
            }
            if (!controller.signal.aborted) {
              setError({
                code: `http_${response.status}`,
                message: serverMessage ?? "The assistant request failed.",
              });
            }
            return;
          }

          if (!response.body) {
            if (!controller.signal.aborted) {
              setError({
                code: "request_failed",
                message: "The assistant request failed.",
              });
            }
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          // Buffer across chunk boundaries — a JSON object can be split
          // mid-line by the network. Never `chunk.split("\n")` in
          // isolation; always prepend the trailing partial from the
          // previous read.
          let buffer = "";

          for (;;) {
            if (controller.signal.aborted) {
              void reader.cancel().catch(() => {});
              return;
            }
            const { done, value } = await reader.read();
            if (controller.signal.aborted) {
              void reader.cancel().catch(() => {});
              return;
            }
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            // The last element is either "" (buffer ended exactly on a
            // newline) or a partial line — either way, it is not yet a
            // complete line and must be retained for the next chunk.
            buffer = lines.pop() ?? "";

            for (const rawLine of lines) {
              if (controller.signal.aborted) return;
              const line = rawLine.trim();
              if (!line) continue;
              const event = parseLine(line);
              if (event) {
                applyEvent(event, controller);
                recordTurnEvent(event);
              }
            }
          }

          // F037: flush the decoder itself, not just the line buffer.
          // `decoder.decode(value, { stream: true })` can hold back the
          // trailing bytes of a multibyte UTF-8 character split across the
          // last `reader.read()` chunk, waiting for the rest — which never
          // arrives once `done` is true. A final `decoder.decode()` call
          // with no arguments (and `stream` defaulting to false) forces
          // that held-back partial sequence out.
          buffer += decoder.decode();

          // Flush any trailing complete line left in the buffer once the
          // stream ends (a final chunk need not end in "\n").
          if (controller.signal.aborted) return;
          const trailing = buffer.trim();
          if (trailing) {
            const event = parseLine(trailing);
            if (event) {
              applyEvent(event, controller);
              recordTurnEvent(event);
            }
          }
        } catch {
          // F034: `err.name === "AbortError"` is unreliable across
          // environments — undici rejects an aborted fetch as
          // `TypeError: fetch failed` with the real abort surfaced only
          // via `.cause`, and jsdom's `DOMException` is not `instanceof
          // Error`. The controller's own signal is the one reliable
          // source of truth for "this turn was intentionally aborted".
          if (controller.signal.aborted) {
            // stop() or a superseding send() aborted this turn — partial
            // text stays visible, no error surfaced.
          } else {
            setError({
              code: "network_error",
              message: "Lost connection to the assistant.",
            });
          }
        } finally {
          if (
            !controller.signal.aborted &&
            abortControllerRef.current === controller &&
            mountedRef.current
          ) {
            setIsStreaming(false);
            abortControllerRef.current = null;
          }

          // F019: persist the assistant turn — on normal completion AND
          // on abort (stop() or a superseding send()), with whatever
          // content/tool-calls/proposals this turn produced before it was
          // cut off (a stopped answer is still worth keeping, per spec).
          // This `finally` is the one place every exit path from the try
          // above (return, throw, fall-through) funnels through exactly
          // once, so persistence never double-fires and never gets
          // skipped for an early-return path.
          const turnToolCalls = Array.from(turnToolCallsMap.values());
          const turnProposals = Array.from(turnProposalsMap.values());

          if (turnText || turnToolCalls.length > 0 || turnProposals.length > 0) {
            void (async () => {
              try {
                const threadId = await threadPromise;
                if (!threadId) return;
                const result = await addMessage(
                  threadId,
                  "assistant",
                  turnText,
                  turnToolCalls as unknown as Json,
                  turnProposals as unknown as Json,
                  turnUsage as unknown as Json,
                );
                if ("error" in result) {
                  logger.error("useDocAssistant: addMessage(assistant) failed", {
                    error: result.error,
                  });
                  return;
                }
                for (const proposal of turnProposals) {
                  proposalLocationRef.current.set(proposal.id, {
                    threadId,
                    messageId: result.id,
                  });
                }
              } catch (persistErr) {
                logger.error("useDocAssistant: assistant-turn persistence threw", {
                  error: persistErr,
                });
              }
            })();
          }
        }
      })();
    },
    [applyEvent, currentDocId, workspaceId],
  );

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
  }, []);

  // F015/F016: one-time state transitions only — a proposal already
  // `accepted` or `rejected` never moves again (both card affordances are
  // one-time, per spec). Guarding here as well as in the card component
  // means the invariant holds even if something else somehow re-invokes
  // these functions for a settled proposal.
  // F019/AS-085: after the in-memory transition, best-effort persist the
  // settled state so a reload never re-arms Accept for the same
  // proposalId. A proposal not yet in `proposalLocationRef` (its owning
  // message hasn't finished persisting yet) simply skips the persistence
  // call — the guard above (`status !== "pending"`) already makes the
  // in-memory transition itself one-time regardless.
  function persistProposalState(id: string, state: "accepted" | "rejected") {
    const location = proposalLocationRef.current.get(id);
    if (!location) return;
    void updateProposalState(location.threadId, location.messageId, id, state).catch(
      (persistErr) => {
        logger.error("useDocAssistant: updateProposalState threw", { error: persistErr });
      },
    );
  }

  const acceptProposal = useCallback((id: string) => {
    let didTransition = false;
    setProposals((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1 || prev[idx].status !== "pending") return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status: "accepted" };
      didTransition = true;
      return next;
    });
    if (didTransition) persistProposalState(id, "accepted");
  }, []);

  const rejectProposal = useCallback((id: string) => {
    let didTransition = false;
    setProposals((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1 || prev[idx].status !== "pending") return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status: "rejected" };
      didTransition = true;
      return next;
    });
    if (didTransition) persistProposalState(id, "rejected");
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    openAssistantIdRef.current = null;
    // AS-083: "New chat" — the OLD thread is left exactly as it was (never
    // deleted, never touched again); nulling this ref is what makes the
    // NEXT send() create a brand new `ai_threads` row instead of appending
    // to the one just left behind.
    threadIdRef.current = null;
    proposalLocationRef.current = new Map();
    setMessages([]);
    setToolCalls([]);
    setProposals([]);
    setIsStreaming(false);
    setError(null);
    setUsage(null);
  }, []);

  // F034: unmount cleanup — abort any in-flight turn's controller so the
  // read loop's aborted-checks stop it, and let it cancel its own reader
  // via those checks. Without this the IIFE keeps reading and calling
  // `setMessages` after unmount, and the model keeps generating (and
  // billing) for a response nobody can render.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortControllerRef.current?.abort();
    };
  }, []);

  // Keep messagesRef in sync so `send()` can read the current
  // conversation synchronously when building the history payload.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // F020: keep usageRef in sync so `send()` can read the running total
  // synchronously.
  useEffect(() => {
    usageRef.current = usage;
  }, [usage]);

  // F019/AS-082: on mount, hydrate this workspace's most recent thread (if
  // any) so reloading the page restores the conversation exactly as it
  // was — messages in order, tool calls/proposals re-rendered, and any
  // already-settled proposal staying settled (AS-085) rather than
  // re-arming Accept. A workspace with no threads yet resolves to `null`
  // and the hook simply starts fresh (empty state), same as it always
  // did before this feature.
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;

    void (async () => {
      try {
        const thread = await getRecentThread(workspaceId);
        if (cancelled || !thread) return;

        threadIdRef.current = thread.id;

        const hydratedMessages: AssistantMessage[] = [];
        const hydratedToolCalls: ToolCallView[] = [];
        const hydratedProposals: ProposalView[] = [];

        for (const message of thread.messages) {
          hydratedMessages.push({
            id: message.id,
            role: toMessageRole(message.role),
            text: message.content,
          });
          for (const toolCall of toArray<ToolCallView>(message.toolCalls)) {
            hydratedToolCalls.push(toolCall);
          }
          for (const proposal of toArray<ProposalView>(message.proposals)) {
            hydratedProposals.push(proposal);
            proposalLocationRef.current.set(proposal.id, {
              threadId: thread.id,
              messageId: message.id,
            });
          }
        }

        if (cancelled) return;
        setMessages(hydratedMessages);
        setToolCalls(hydratedToolCalls);
        setProposals(hydratedProposals);
      } catch (hydrateErr) {
        logger.error("useDocAssistant: getRecentThread failed", { error: hydrateErr });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return {
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
  };
}
