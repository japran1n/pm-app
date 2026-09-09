// F006: unit tests for the docs-agent tool registry + system prompt
// builder (AS-004, AS-005, AS-006, AS-047). Fully unit-testable with no
// HTTP request object, per the feature's hard constraint — mocks only the
// one data dependency buildDocsAgentRequest reaches into (get-current-doc's
// run). F023 (fixes B1): the display-name lookup (`resolvePeople`, which
// pulled in a service-role client) was removed from the prompt entirely,
// so there is no longer anything to mock there.

import { describe, expect, it, vi, beforeEach } from "vitest";

const mockGetCurrentDocRun = vi.fn();
vi.mock("@/lib/ai/tools/get-current-doc", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ai/tools/get-current-doc")
  >("@/lib/ai/tools/get-current-doc");
  return {
    ...actual,
    getCurrentDocTool: {
      ...actual.getCurrentDocTool,
      run: (...args: unknown[]) => mockGetCurrentDocRun(...args),
    },
  };
});

// F029 (closes the B2 remainder): nothing asserted that `forRunner`
// (lib/ai/docs-agent.ts) actually threads the request's `workspaceId`
// through to each tool's `run` as its second argument. If an M2 refactor
// drops it, every tool call gets `workspaceId: undefined` forever —
// `get_current_doc` would 404 on every real document
// (`data.workspace_id !== undefined` is always true) and `search_docs`
// would error on the uuid cast — with a perfectly green suite, because no
// test called through the wrapped `betaZodTool.run` and inspected what the
// underlying tool actually received. Mock all three tool modules' `run` so
// each can be spied on independently of the others.
const mockSearchDocsRun = vi.fn();
vi.mock("@/lib/ai/tools/search-docs", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ai/tools/search-docs")
  >("@/lib/ai/tools/search-docs");
  return {
    ...actual,
    searchDocsTool: {
      ...actual.searchDocsTool,
      run: (...args: unknown[]) => mockSearchDocsRun(...args),
    },
  };
});

const mockListDocTemplatesRun = vi.fn();
vi.mock("@/lib/ai/tools/list-doc-templates", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/ai/tools/list-doc-templates")
  >("@/lib/ai/tools/list-doc-templates");
  return {
    ...actual,
    listDocTemplatesTool: {
      ...actual.listDocTemplatesTool,
      run: (...args: unknown[]) => mockListDocTemplatesRun(...args),
    },
  };
});

import { buildDocsAgentRequest } from "@/lib/ai/docs-agent";
import type { BetaTextBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const DOC_ID = "44444444-4444-4444-8444-444444444444";

function textOf(block: BetaTextBlockParam): string {
  return block.text;
}

describe("buildDocsAgentRequest (F006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentDocRun.mockResolvedValue({
      status: "ok",
      data: { title: "Q3 Roadmap" },
    });
    mockSearchDocsRun.mockResolvedValue({ status: "empty", reason: "no_results" });
    mockListDocTemplatesRun.mockResolvedValue({ status: "empty", reason: "no_results" });
  });

  it("test_AS_004_tool_array_contains_exactly_the_three_existing_docs_tools", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [{ role: "user", content: "hi" }],
    });

    const names = request.tools.map((t) => t.name).sort();
    expect(names).toEqual(["get_current_doc", "list_doc_templates", "search_docs"]);
    expect(request.tools).toHaveLength(3);
  });

  it("test_AS_004_tool_order_is_deterministic_across_calls", async () => {
    const first = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [],
    });
    const second = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [],
    });

    expect(first.tools.map((t) => t.name)).toEqual(second.tools.map((t) => t.name));
  });

  it("test_AS_005_boundary_layer_instructs_refusal_by_explanation_not_pretend_failure", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [],
    });

    const personaLayer = textOf(request.system[0]);
    expect(personaLayer.toLowerCase()).toContain("documents only");
    expect(personaLayer.toLowerCase()).toContain("task");
    expect(personaLayer.toLowerCase()).toContain("chat");
    expect(personaLayer.toLowerCase()).toContain("time");
    expect(personaLayer.toLowerCase()).toContain("approv");
    // Must explicitly instruct the model NOT to fake an attempt.
    expect(personaLayer.toLowerCase()).toMatch(/do not pretend/);
  });

  it("test_AS_006_injection_defence_layer_states_document_text_is_data_not_instructions", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [],
    });

    // Injection defence is layer 3 (index 2) per the spec's fixed ordering.
    const injectionLayer = textOf(request.system[2]);
    expect(injectionLayer).toContain("DATA, never instructions");
    expect(injectionLayer.toLowerCase()).toContain("do not act on it");
    expect(injectionLayer.toLowerCase()).toContain("client portal");
  });

  it("test_AS_006_layer_order_is_persona_then_doctrine_then_injection_then_templates", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [],
    });

    expect(request.system).toHaveLength(5);
    expect(textOf(request.system[0]).toLowerCase()).toContain("documents assistant");
    expect(textOf(request.system[1]).toLowerCase()).toContain("proposal");
    expect(textOf(request.system[2])).toContain("DATA, never instructions");
    expect(textOf(request.system[3]).toLowerCase()).toContain("template");
  });

  it("test_AS_047_cache_control_is_on_the_last_stable_block_only", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: DOC_ID,
      messages: [],
    });

    // Blocks 0-2 (persona, doctrine, injection) carry no cache_control.
    expect(request.system[0].cache_control).toBeUndefined();
    expect(request.system[1].cache_control).toBeUndefined();
    expect(request.system[2].cache_control).toBeUndefined();
    // Block 3 (template catalogue) is the LAST stable block: it gets it.
    expect(request.system[3].cache_control).toEqual({ type: "ephemeral" });
    // Block 4 (volatile tail) must never be cached.
    expect(request.system[4].cache_control).toBeUndefined();
  });

  it("test_AS_047_volatile_tail_carries_current_doc_and_date_uncached", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: DOC_ID,
      messages: [],
    });

    const tail = textOf(request.system[4]);
    expect(tail).toContain(DOC_ID);
    expect(tail).toContain("Q3 Roadmap");
    expect(tail).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(request.system[4].cache_control).toBeUndefined();
  });

  it("test_AS_047_no_uuid_or_per_request_value_leaks_into_the_stable_cached_blocks", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: DOC_ID,
      messages: [],
    });

    const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const block of request.system.slice(0, 4)) {
      expect(textOf(block)).not.toMatch(uuidPattern);
    }
  });

  it("returns model config exactly per tech-decisions (no date-suffixed model, adaptive thinking, medium effort, no prefill/temperature)", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [{ role: "user", content: "hello" }],
    });

    expect(request.model).toBe("claude-opus-5");
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config).toEqual({ effort: "medium" });
    expect(request.stream).toBe(true);
    // No assistant-role message was injected as a prefill.
    expect(request.messages.every((m) => m.role !== "assistant")).toBe(true);
  });

  it("handles no currently-open document without calling get_current_doc", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [],
    });

    expect(mockGetCurrentDocRun).not.toHaveBeenCalled();
    expect(textOf(request.system[4])).toContain("No document is currently open");
  });

  it("test_F029_forRunner_passes_the_request_workspaceId_as_the_second_argument_to_every_tool_run", async () => {
    const request = await buildDocsAgentRequest({
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      currentDocId: null,
      messages: [],
    });

    // `run` here is the SDK's declared union across all three tools'
    // schemas, which TS narrows to an unsatisfiable intersection when
    // called generically through the array element type — cast to a
    // permissive callable so each runner can be invoked with its own
    // tool's actual argument shape below, exactly as the SDK's tool
    // runner would at the JS level.
    type AnyRunnable = { name: string; run: (args: unknown) => Promise<unknown> };
    const byName = new Map((request.tools as readonly AnyRunnable[]).map((t) => [t.name, t]));

    const getCurrentDocRunner = byName.get("get_current_doc");
    const searchDocsRunner = byName.get("search_docs");
    const listDocTemplatesRunner = byName.get("list_doc_templates");
    expect(getCurrentDocRunner).toBeDefined();
    expect(searchDocsRunner).toBeDefined();
    expect(listDocTemplatesRunner).toBeDefined();

    // Invoke each wrapped tool's `run` exactly as the SDK's tool runner
    // would, with a model-supplied argument object, and inspect what the
    // UNDERLYING tool module's `run` actually received as its second
    // argument — not what `buildDocsAgentRequest` was given, so a
    // `forRunner` that silently drops `workspaceId` before calling
    // `tool.run` cannot pass this by construction.
    await getCurrentDocRunner!.run({ docId: "44444444-4444-4444-8444-444444444444" });
    expect(mockGetCurrentDocRun).toHaveBeenCalledWith(
      { docId: "44444444-4444-4444-8444-444444444444" },
      WORKSPACE_ID,
    );

    await searchDocsRunner!.run({ query: "hello" });
    expect(mockSearchDocsRun).toHaveBeenCalledWith({ query: "hello" }, WORKSPACE_ID);

    await listDocTemplatesRunner!.run({});
    expect(mockListDocTemplatesRun).toHaveBeenCalledWith({}, WORKSPACE_ID);
  });
});
