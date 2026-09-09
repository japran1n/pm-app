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
  // F034: guards the unmount race — an in-flight turn's `finally` block
  // must not call `setIsStreaming` after the component has unmounted.
  const mountedRef = useRef(true);

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

      setMessages((prev) => [...prev, userMessage]);

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
              if (event) applyEvent(event, controller);
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
            if (event) applyEvent(event, controller);
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
  const acceptProposal = useCallback((id: string) => {
    setProposals((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1 || prev[idx].status !== "pending") return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status: "accepted" };
      return next;
    });
  }, []);

  const rejectProposal = useCallback((id: string) => {
    setProposals((prev) => {
      const idx = prev.findIndex((p) => p.id === id);
      if (idx === -1 || prev[idx].status !== "pending") return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], status: "rejected" };
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    openAssistantIdRef.current = null;
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
