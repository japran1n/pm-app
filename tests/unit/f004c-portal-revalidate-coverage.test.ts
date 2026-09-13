// F004c (missions/20260914-portal-simplify): unit coverage for AS-006's
// second remediation round — every newly-covered action call site asserts
// the exact `/portal/<slug>/p/<projectId>` "layout" `revalidatePath` call,
// and that a NON-client-visible (or internal-only) task/comment/doc never
// triggers it. `next/cache` is mocked throughout so no real Next.js
// request/render context is required.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/observability/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...args),
}));

const WORKSPACE_SLUG = "acme";
const PROJECT_ID = "00000000-0000-4000-8000-0000000000f1";
const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000ff";
const TASK_ID = "00000000-0000-4000-8000-000000000010";
const USER_ID = "00000000-0000-4000-8000-000000000099";

let currentUser: { id: string } | null = { id: USER_ID };

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: vi.fn(async () => ({ data: { user: currentUser } })) },
    channel: vi.fn(() => ({ send: vi.fn(async () => {}) })),
    removeChannel: vi.fn(async () => {}),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: null, error: null })) })),
      })),
    })),
  })),
}));

vi.mock("@/lib/auth/require-membership", () => ({
  requireActiveMembership: vi.fn(async () => ({ ok: true, role: "member" })),
  requireWorkspaceAdmin: vi.fn(async () => ({ ok: true, role: "admin" })),
}));

vi.mock("@/lib/actions/project-visibility", () => ({
  isProjectVisibleToCaller: vi.fn(async () => true),
}));

beforeEach(() => {
  revalidatePath.mockClear();
  currentUser = { id: USER_ID };
});

// ---------------------------------------------------------------------
// lib/actions/tasks/ordering.ts — moveTaskStatus / reorderTask
// ---------------------------------------------------------------------
describe("F004c / AS-006: tasks/ordering.ts revalidates the portal for client-visible tasks", () => {
  function buildOrderingAdminMock(clientVisible: boolean) {
    return {
      from: vi.fn((table: string) => {
        if (table === "tasks") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: {
                      id: TASK_ID,
                      deleted_at: null,
                      project_id: PROJECT_ID,
                      title: "Task",
                      description: null,
                      description_json: null,
                      priority: null,
                      estimate_minutes: null,
                      due_date: null,
                      recurrence: null,
                      recurrence_parent_id: null,
                      status: "todo",
                      task_type_id: "type-1",
                      client_visible: clientVisible,
                      projects: {
                        id: PROJECT_ID,
                        workspace_id: WORKSPACE_ID,
                        visibility: "workspace",
                        workspaces: { slug: WORKSPACE_SLUG },
                      },
                    },
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: TASK_ID, status: "in_progress", position: 2 },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        if (table === "project_statuses") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: { id: "status-1", category: "in_progress" },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        if (table === "task_watchers") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: [], error: null })),
              })),
            })),
          };
        }
        if (table === "workspaces") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { slug: WORKSPACE_SLUG },
                  error: null,
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    };
  }

  it("test_AS_006_moveTaskStatus_revalidates_portal_for_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildOrderingAdminMock(true),
    }));
    const { moveTaskStatus } = await import("@/lib/actions/tasks/ordering");

    const result = await moveTaskStatus(TASK_ID, "in_progress");
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
  });

  it("test_AS_006_moveTaskStatus_does_not_revalidate_portal_for_non_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildOrderingAdminMock(false),
    }));
    const { moveTaskStatus } = await import("@/lib/actions/tasks/ordering");

    const result = await moveTaskStatus(TASK_ID, "in_progress");
    expect(result.ok).toBe(true);
    expect(
      revalidatePath.mock.calls.some((call) => String(call[0]).startsWith("/portal/")),
    ).toBe(false);
  });

  it("test_AS_006_reorderTask_revalidates_portal_for_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildOrderingAdminMock(true),
    }));
    const { reorderTask } = await import("@/lib/actions/tasks/ordering");

    const result = await reorderTask(TASK_ID, 3);
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
  });

  it("test_AS_006_reorderTask_does_not_revalidate_portal_for_non_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildOrderingAdminMock(false),
    }));
    const { reorderTask } = await import("@/lib/actions/tasks/ordering");

    const result = await reorderTask(TASK_ID, 3);
    expect(result.ok).toBe(true);
    expect(
      revalidatePath.mock.calls.some((call) => String(call[0]).startsWith("/portal/")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------
// lib/actions/attachments.ts — deleteAttachment
// ---------------------------------------------------------------------
describe("F004c / AS-006: attachments.ts's deleteAttachment revalidates the portal", () => {
  function buildAttachmentsAdminMock(clientVisible: boolean) {
    return {
      from: vi.fn((table: string) => {
        if (table === "attachments") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    id: "00000000-0000-4000-8000-0000000000a1",
                    file_url: "task-1/file.png",
                    uploaded_by: USER_ID,
                    tasks: {
                      project_id: PROJECT_ID,
                      deleted_at: null,
                      client_visible: clientVisible,
                      projects: {
                        workspace_id: WORKSPACE_ID,
                        visibility: "workspace",
                        workspaces: { slug: WORKSPACE_SLUG },
                      },
                    },
                  },
                  error: null,
                })),
              })),
            })),
            delete: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: { id: "00000000-0000-4000-8000-0000000000a1" }, error: null })),
                })),
              })),
            })),
          };
        }
        if (table === "workspaces") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { slug: WORKSPACE_SLUG },
                  error: null,
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn(async () => ({ error: null })),
        })),
      },
    };
  }

  it("test_AS_006_deleteAttachment_revalidates_portal_for_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildAttachmentsAdminMock(true),
    }));
    const { deleteAttachment } = await import("@/lib/actions/attachments");

    const result = await deleteAttachment("00000000-0000-4000-8000-0000000000a1");
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
  });

  it("test_AS_006_deleteAttachment_does_not_revalidate_portal_for_non_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildAttachmentsAdminMock(false),
    }));
    const { deleteAttachment } = await import("@/lib/actions/attachments");

    const result = await deleteAttachment("00000000-0000-4000-8000-0000000000a1");
    expect(result.ok).toBe(true);
    expect(
      revalidatePath.mock.calls.some((call) => String(call[0]).startsWith("/portal/")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------
// lib/actions/comments.ts — deleteComment (client-visible + internal gate)
// ---------------------------------------------------------------------
describe("F004c / AS-006: comments.ts's deleteComment revalidates the portal", () => {
  function buildCommentsAdminMock(clientVisible: boolean, internal: boolean) {
    return {
      from: vi.fn((table: string) => {
        if (table === "comments") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                is: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({
                    data: {
                      id: "00000000-0000-4000-8000-0000000000c1",
                      user_id: USER_ID,
                      deleted_at: null,
                      internal,
                      tasks: {
                        id: TASK_ID,
                        project_id: PROJECT_ID,
                        client_visible: clientVisible,
                        projects: {
                          workspace_id: WORKSPACE_ID,
                          workspaces: { slug: WORKSPACE_SLUG },
                        },
                      },
                    },
                    error: null,
                  })),
                })),
              })),
            })),
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: { id: "00000000-0000-4000-8000-0000000000c1", deleted_at: new Date().toISOString() },
                    error: null,
                  })),
                })),
              })),
            })),
          };
        }
        if (table === "tasks") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { project_id: PROJECT_ID, projects: { visibility: "workspace" } },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "workspaces") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { slug: WORKSPACE_SLUG },
                  error: null,
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    };
  }

  it("test_AS_006_deleteComment_revalidates_portal_for_client_visible_non_internal_comment", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildCommentsAdminMock(true, false),
    }));
    const { deleteComment } = await import("@/lib/actions/comments");

    const result = await deleteComment("00000000-0000-4000-8000-0000000000c1");
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
  });

  it("test_AS_006_deleteComment_does_not_revalidate_portal_for_non_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildCommentsAdminMock(false, false),
    }));
    const { deleteComment } = await import("@/lib/actions/comments");

    const result = await deleteComment("00000000-0000-4000-8000-0000000000c1");
    expect(result.ok).toBe(true);
    expect(
      revalidatePath.mock.calls.some((call) => String(call[0]).startsWith("/portal/")),
    ).toBe(false);
  });

  it("test_AS_006_deleteComment_does_not_revalidate_portal_for_internal_comment_on_client_visible_task", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({
      createAdminClient: () => buildCommentsAdminMock(true, true),
    }));
    const { deleteComment } = await import("@/lib/actions/comments");

    const result = await deleteComment("00000000-0000-4000-8000-0000000000c1");
    expect(result.ok).toBe(true);
    expect(
      revalidatePath.mock.calls.some((call) => String(call[0]).startsWith("/portal/")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------
// lib/actions/docs.ts — setDocClientVisibility
// ---------------------------------------------------------------------
describe("F004c / AS-006: docs.ts's setDocClientVisibility revalidates the portal", () => {
  function buildDocsAdminMock() {
    return null; // docs.ts never uses the admin client
  }
  void buildDocsAdminMock;

  function mockDocsSupabase(newClientVisible: boolean) {
    return {
      auth: { getUser: vi.fn(async () => ({ data: { user: currentUser } })) },
      from: vi.fn((table: string) => {
        if (table === "docs") {
          return {
            update: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: {
                    project_id: PROJECT_ID,
                    client_visible: newClientVisible,
                    projects: { workspaces: { slug: WORKSPACE_SLUG } },
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    };
  }

  it("test_AS_006_setDocClientVisibility_revalidates_portal_when_sharing", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn(async () => mockDocsSupabase(true)),
    }));
    const { setDocClientVisibility } = await import("@/lib/actions/docs");

    const result = await setDocClientVisibility("00000000-0000-4000-8000-0000000000d1", true);
    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
  });

  it("test_AS_006_setDocClientVisibility_does_not_revalidate_portal_when_doc_stays_hidden", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn(async () => mockDocsSupabase(false)),
    }));
    const { setDocClientVisibility } = await import("@/lib/actions/docs");

    const result = await setDocClientVisibility("00000000-0000-4000-8000-0000000000d1", false);
    expect(result.ok).toBe(true);
    expect(
      revalidatePath.mock.calls.some((call) => String(call[0]).startsWith("/portal/")),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------
// lib/actions/brief.ts — createBriefQuestion (always portal-visible)
// ---------------------------------------------------------------------
describe("F004c / AS-006: brief.ts's createBriefQuestion always revalidates the portal", () => {
  function mockBriefSupabase() {
    return {
      auth: { getUser: vi.fn(async () => ({ data: { user: currentUser } })) },
      from: vi.fn((table: string) => {
        if (table === "briefs") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: { id: "00000000-0000-4000-8000-0000000000b1" }, error: null })),
              })),
            })),
            insert: vi.fn(async () => ({ error: null })),
          };
        }
        if (table === "brief_questions") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => ({
                    maybeSingle: vi.fn(async () => ({ data: null, error: null })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: {
                    id: "00000000-0000-4000-8000-0000000000e1",
                    project_id: PROJECT_ID,
                    prompt: "What do you need?",
                    category: null,
                    answer_type: "text",
                    help_text: null,
                    required: true,
                    options: null,
                    position: 1,
                  },
                  error: null,
                })),
              })),
            })),
          };
        }
        if (table === "projects") {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({
                  data: { workspaces: { slug: WORKSPACE_SLUG } },
                  error: null,
                })),
              })),
            })),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    };
  }

  it("test_AS_006_createBriefQuestion_revalidates_portal_layout", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: vi.fn(async () => mockBriefSupabase()),
    }));
    const { createBriefQuestion } = await import("@/lib/actions/brief");

    const result = await createBriefQuestion(PROJECT_ID, {
      prompt: "What do you need?",
      category: "General",
      answerType: "short_text",
      helpText: null,
      required: true,
      options: undefined,
    });

    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith(
      `/portal/${WORKSPACE_SLUG}/p/${PROJECT_ID}`,
      "layout",
    );
  });
});
