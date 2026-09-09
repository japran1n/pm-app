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
//   {"t":"tool_start","id":"...","name":"..."}
//   {"t":"tool_end","id":"...","summary":"...","detail"?:"..."}
//   {"t":"proposal","id":"...","kind":"doc_edit"|"doc_create","payload":{...}}
//   {"t":"usage","in":123,"out":456,"cached":789}
//   {"t":"error","code":"...","message":"..."}
//   {"t":"done"}
// Unknown `t` values are ignored rather than thrown on — the envelope is
// expected to grow in M3.
import { useCallback, useRef, useState } from "react";

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export interface ToolCallView {
  id: string;
  name: string;
  status: "running" | "done";
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
}

type NdjsonEvent =
  | { t: "text"; v: string }
  | { t: "tool_start"; id: string; name: string }
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

  const abortControllerRef = useRef<AbortController | null>(null);
  // Tracks the id of the assistant message currently receiving `text`
  // deltas, so consecutive deltas append to the same message rather than
  // each creating a new one.
  const openAssistantIdRef = useRef<string | null>(null);

  const applyEvent = useCallback((event: NdjsonEvent) => {
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
        const { id, name } = event as Extract<NdjsonEvent, { t: "tool_start" }>;
        setToolCalls((prev) => {
          const idx = prev.findIndex((tc) => tc.id === id);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...next[idx], name, status: "running" };
            return next;
          }
          return [...prev, { id, name, status: "running" as const }];
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
            }),
            signal: controller.signal,
          });

          if (!response.ok || !response.body) {
            setError({
              code: "request_failed",
              message: "The assistant request failed.",
            });
            setIsStreaming(false);
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
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            // The last element is either "" (buffer ended exactly on a
            // newline) or a partial line — either way, it is not yet a
            // complete line and must be retained for the next chunk.
            buffer = lines.pop() ?? "";

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              const event = parseLine(line);
              if (event) applyEvent(event);
            }
          }

          // Flush any trailing complete line left in the buffer once the
          // stream ends (a final chunk need not end in "\n").
          const trailing = buffer.trim();
          if (trailing) {
            const event = parseLine(trailing);
            if (event) applyEvent(event);
          }
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") {
            // stop() or a superseding send() aborted this turn — partial
            // text stays visible, no error surfaced.
          } else {
            setError({
              code: "network_error",
              message: "Lost connection to the assistant.",
            });
          }
        } finally {
          if (abortControllerRef.current === controller) {
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
  };
}
