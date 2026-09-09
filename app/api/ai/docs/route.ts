// F007: the one HTTP entry point for the docs sidebar's AI assistant.
//
// Per this feature's spec, this file contains NO prompt text at all — every
// string a model ever sees lives in lib/ai/docs-agent.ts (F006). This route
// is pure transport: auth, stream translation, the tool loop's bookkeeping
// (start/end pairing, the 8-call cap, proposal short-circuit), and clean
// error mapping. It never imports a service-role client (AS-001) — the
// RLS-respecting cookie client from lib/supabase/server is the only
// identity/authorization boundary this route uses.
//
// Event envelope (tech-decisions.md, verbatim, one JSON object per `\n`):
//   {"t":"text","v":"..."}
//   {"t":"tool_start","id":"...","name":"..."}
//   {"t":"tool_end","id":"...","summary":"...","detail":"..."}
//   {"t":"proposal","id":"...","kind":"doc_edit"|"doc_create","payload":{...}}
//   {"t":"usage","in":123,"out":456,"cached":789}
//   {"t":"error","code":"...","message":"..."}
//   {"t":"done"}
//
// Persistence (F018/F019) and rate limiting (F020) are explicitly out of
// scope. `threadId` is accepted and ignored — no schema is invented here.

export const runtime = "nodejs";

import { z } from "zod";

import { APIError, RateLimitError } from "@anthropic-ai/sdk";
import type {
  BetaContentBlock,
  BetaMessageParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";

import { buildDocsAgentRequest } from "@/lib/ai/docs-agent";
import { getAnthropicClient, hasApiKey } from "@/lib/ai/client";
import { logger } from "@/lib/observability/logger";
import { createClient } from "@/lib/supabase/server";

/** AS-048: hard cap on tool calls in a single turn (across all iterations). */
const MAX_TOOL_CALLS_PER_TURN = 8;

const requestBodySchema = z.object({
  // Accepted and ignored per spec — persistence lands in F018/F019. No
  // schema is invented for it here.
  threadId: z.string().optional(),
  message: z.string().trim().min(1, "message is required."),
  currentDocId: z.string().optional(),
  // F027 (fixes M1-SCRUTINY.md M1c, AS-023/AS-024): the docs sidebar
  // always knows which workspace it is rendered inside (the page route
  // itself is workspace-scoped), so the caller supplies it explicitly —
  // same convention app/api/extension/context/route.ts uses for
  // `?workspaceId=`. Verified against the caller's own real membership
  // below before it is trusted for anything.
  workspaceId: z.string().min(1, "workspaceId is required."),
});

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
  | { t: "done" };

/**
 * The only tools whose successful result can be treated as an edit
 * proposal (F014/F017, not yet registered). Keyed on the tool's *name* —
 * a value the route itself controls — rather than duck-typing on
 * model-adjacent `data.kind`, which a tool's output shape could spoof.
 */
const PROPOSAL_TOOL_NAMES = new Set(["propose_doc_edit", "create_doc"]);

/** A tool result shaped like a write-tool proposal (F014/F017, not yet registered). */
function asProposal(
  toolName: string,
  content: string,
): { kind: "doc_edit" | "doc_create"; payload: unknown } | null {
  if (!PROPOSAL_TOOL_NAMES.has(toolName)) return null;
  try {
    const parsed = JSON.parse(content) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "status" in parsed &&
      (parsed as { status: unknown }).status === "ok" &&
      "data" in parsed
    ) {
      const data = (parsed as { data: unknown }).data;
      if (
        data &&
        typeof data === "object" &&
        "kind" in data &&
        ((data as { kind: unknown }).kind === "doc_edit" ||
          (data as { kind: unknown }).kind === "doc_create")
      ) {
        return {
          kind: (data as { kind: "doc_edit" | "doc_create" }).kind,
          payload: data,
        };
      }
    }
  } catch {
    // Not JSON, or not the ToolResult envelope shape — not a proposal.
  }
  return null;
}

/** A short, safe-to-render one-line summary for a tool_end event. Never leaks raw content. */
function summarizeToolResult(content: string): string {
  try {
    const parsed = JSON.parse(content) as { status?: string; message?: string };
    if (parsed?.status === "ok") return "ok";
    if (parsed?.status === "empty") return parsed.message ?? "no results";
    if (parsed?.status === "error") return parsed.message ?? "tool error";
  } catch {
    // fall through
  }
  return "ok";
}

export async function POST(request: Request) {
  // --- Auth first, before any model call (AS-007). ---------------------
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: z.infer<typeof requestBodySchema>;
  try {
    const json = await request.json();
    body = requestBodySchema.parse(json);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // F027 (fixes M1-SCRUTINY.md M1c, AS-023/AS-024): re-verify the caller
  // is an ACTIVE member of the workspace they claim is current before it
  // is trusted for anything downstream — same `workspace_id`/`user_id`/
  // `status='active'` shape `lib/auth/require-membership.ts`'s
  // `requireActiveMembership` uses, but on the RLS-respecting session
  // client rather than an admin client: this route lives under
  // app/api/ai/**, which the AS-001 transitive-import guard
  // (lib/ai/__tests__/no-service-role.test.ts) also scans, so no
  // service-role client may ever be reachable from here. The
  // `workspace_members_select_fellow_members` RLS policy already lets a
  // caller read their own membership row, which is all this needs.
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("status")
    .eq("workspace_id", body.workspaceId)
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (membershipError || !membership) {
    return new Response(JSON.stringify({ error: "You don't have access to that workspace." }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  // AS-044: propagate the client's abort into the SDK call so an abandoned
  // request doesn't keep billing for a response nobody reads. Declared
  // outside `start()` so the ReadableStream's `cancel()` callback (invoked
  // when the *consumer* — e.g. the browser's fetch reader — goes away) can
  // reach the same per-request controller and closed flag. `cancel()` is a
  // distinct signal from `request.signal` aborting: either one must tear
  // this down.
  const abortController = new AbortController();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: NdjsonEvent) => {
        if (closed || abortController.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Controller may already be closed/errored (e.g. a race between
          // cancel() and this call) — never let enqueue throw out of here.
          closed = true;
        }
      };
      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed/errored by cancel() or the platform — harmless.
        }
      };

      const onClientAbort = () => abortController.abort();
      request.signal.addEventListener("abort", onClientAbort);

      try {
        // AS-045: no API key -> one `error` (code no_api_key), then `done`,
        // HTTP 200 throughout (the stream is already open by this point).
        if (!hasApiKey()) {
          send({ t: "error", code: "no_api_key", message: "The AI assistant is not configured yet." });
          send({ t: "done" });
          finish();
          return;
        }

        const client = getAnthropicClient();

        const agentRequest = await buildDocsAgentRequest({
          userId: user.id,
          // F027: the caller's `workspaceId`, already re-verified as an
          // active membership above — threaded into every tool call as
          // defence in depth on top of RLS (AS-023/AS-024).
          workspaceId: body.workspaceId,
          currentDocId: body.currentDocId ?? null,
          messages: [
            { role: "user", content: body.message } satisfies BetaMessageParam,
          ],
        });

        let messages: BetaMessageParam[] = [...agentRequest.messages];
        let toolCallCount = 0;
        let totalIn = 0;
        let totalOut = 0;
        let totalCached = 0;
        let turnEnded = false;
        let proposalEmitted = false;

        while (!turnEnded) {
          if (abortController.signal.aborted) break;

          const anthropicStream = client.beta.messages.stream(
            {
              model: agentRequest.model,
              max_tokens: agentRequest.max_tokens,
              system: agentRequest.system,
              messages,
              tools: [...agentRequest.tools],
              thinking: agentRequest.thinking,
              output_config: agentRequest.output_config,
            },
            { signal: abortController.signal },
          );

          anthropicStream.on("text", (delta) => {
            send({ t: "text", v: delta });
          });

          let finalMessage;
          try {
            finalMessage = await anthropicStream.finalMessage();
          } catch (streamError) {
            handleUpstreamError(streamError, send, abortController.signal.aborted);
            finish();
            return;
          }

          totalIn += finalMessage.usage.input_tokens;
          totalOut += finalMessage.usage.output_tokens;
          totalCached += finalMessage.usage.cache_read_input_tokens ?? 0;

          messages = [...messages, { role: "assistant", content: finalMessage.content }];

          const toolUseBlocks = finalMessage.content.filter(
            (block): block is Extract<BetaContentBlock, { type: "tool_use" }> =>
              block.type === "tool_use",
          );

          if (toolUseBlocks.length === 0) {
            // No tools requested this turn — the assistant is done.
            turnEnded = true;
            break;
          }

          // AS-048: cap total tool calls in this turn at 8, across every
          // iteration of the loop, not just this one.
          if (toolCallCount + toolUseBlocks.length > MAX_TOOL_CALLS_PER_TURN) {
            send({ t: "error", code: "tool_limit", message: "Too many tool calls in this turn." });
            send({ t: "done" });
            finish();
            return;
          }

          const toolResultBlocks: Array<{
            type: "tool_result";
            tool_use_id: string;
            content: string;
            is_error?: boolean;
          }> = [];

          for (const toolUse of toolUseBlocks) {
            toolCallCount += 1;
            send({ t: "tool_start", id: toolUse.id, name: toolUse.name });

            const tool = agentRequest.tools.find((t) => t.name === toolUse.name);

            let resultContent: string;
            let isError = false;

            if (!tool) {
              resultContent = `Error: Tool '${toolUse.name}' not found`;
              isError = true;
              send({ t: "tool_end", id: toolUse.id, summary: "tool error", detail: resultContent });
            } else {
              try {
                const input: unknown = tool.parse ? tool.parse(toolUse.input) : toolUse.input;
                // tool.run's input type is specific to each tool; this loop is generic
                // over all of them (the same shape the SDK's own internal runner uses).
                const raw = await (tool.run as (input: never, ctx: unknown) => Promise<string | unknown>)(input as never, {
                  toolUse,
                  toolUseBlock: toolUse,
                  signal: abortController.signal,
                });
                resultContent = typeof raw === "string" ? raw : JSON.stringify(raw);
                // AS-042: every tool_start gets exactly one matching
                // tool_end, including on a thrown error (handled below).
                send({ t: "tool_end", id: toolUse.id, summary: summarizeToolResult(resultContent) });
              } catch (toolError) {
                isError = true;
                // AS-105 / lib/ai/tools/types.ts:33: never pass a thrown
                // error's message through to the client — Zod v4 parse
                // failures embed the offending input value, and transport
                // errors can carry URLs. Log the detail server-side only;
                // the client gets a generic, safe-to-render summary.
                const safeMessage = "Tool execution failed.";
                resultContent = `Error: ${safeMessage}`;
                logger.error("docs agent: tool threw", {
                  tool: toolUse.name,
                  id: toolUse.id,
                  detail: toolError instanceof Error ? toolError.message : String(toolError),
                });
                send({ t: "tool_end", id: toolUse.id, summary: "tool error", detail: safeMessage });
              }
            }

            toolResultBlocks.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: resultContent,
              ...(isError ? { is_error: true } : {}),
            });

            // AS-043: a write tool's proposal ends the turn immediately —
            // the model must never be allowed to continue as though the
            // edit were applied.
            if (!isError) {
              const proposal = asProposal(toolUse.name, resultContent);
              if (proposal) {
                send({
                  t: "proposal",
                  id: toolUse.id,
                  kind: proposal.kind,
                  payload: proposal.payload,
                });
                proposalEmitted = true;
              }
            }
          }

          if (proposalEmitted) {
            turnEnded = true;
            break;
          }

          messages = [
            ...messages,
            { role: "user", content: toolResultBlocks },
          ];
        }

        send({ t: "usage", in: totalIn, out: totalOut, cached: totalCached });
        send({ t: "done" });
        finish();
      } catch (error) {
        if (isAbortLike(error) || abortController.signal.aborted) {
          // Client went away — nothing left to stream to.
          finish();
          return;
        }
        handleUpstreamError(error, send, abortController.signal.aborted);
        finish();
      } finally {
        request.signal.removeEventListener("abort", onClientAbort);
      }
    },
    cancel() {
      // Called when the stream's consumer goes away (e.g. the client's
      // fetch reader is cancelled/aborted). Must reach the SAME per-request
      // abortController `start()` uses, and must mark `closed` so `finish()`
      // never calls `controller.close()` on an already-torn-down controller.
      closed = true;
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isAbortLike(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "AbortError" || error.name === "APIUserAbortError")
  );
}

/** Maps an upstream Anthropic SDK failure to a safe error event (AS-046, AS-105). */
function handleUpstreamError(
  error: unknown,
  send: (event: NdjsonEvent) => void,
  clientAborted: boolean,
) {
  if (clientAborted || isAbortLike(error)) {
    // Nobody is listening; nothing to send.
    return;
  }

  if (error instanceof RateLimitError) {
    logger.warn("docs agent: upstream rate limited");
    send({ t: "error", code: "rate_limited", message: "The assistant is busy right now. Please try again shortly." });
    send({ t: "done" });
    return;
  }

  if (error instanceof APIError) {
    // Never surface raw upstream error bodies (AS-105) — a short, generic,
    // safe-to-display message only.
    logger.error("docs agent: upstream API error", { status: error.status });
    send({ t: "error", code: "upstream", message: "The assistant is temporarily unavailable." });
    send({ t: "done" });
    return;
  }

  // AS-105: do not pass raw error text into the log line either — a
  // generic marker is enough to correlate; keep detail out entirely rather
  // than risk another wire-adjacent leak surface.
  logger.error("docs agent: unexpected error", {
    name: error instanceof Error ? error.name : "unknown",
  });
  send({ t: "error", code: "upstream", message: "The assistant is temporarily unavailable." });
  send({ t: "done" });
}
