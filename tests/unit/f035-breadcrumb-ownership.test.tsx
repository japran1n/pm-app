// @vitest-environment jsdom
//
// F035 (M2 review B4): `useSetBreadcrumb` used to be a single-slot
// replace — the LAST writer to run its effect won, and any writer's
// unmount cleared the crumb for ALL of them. On
// `/w/<slug>/projects/<id>/docs/<docId>`, `ProjectBreadcrumb`
// (components/project/project-breadcrumb.tsx) and `MarkdownEditor`
// (components/docs/markdown-editor.tsx, F009) are BOTH mounted at once —
// the editor's effect clobbered the project crumb, and navigating away
// from the doc (unmounting the editor) wiped the project crumb too, even
// though `ProjectBreadcrumb` was still mounted.
//
// These tests mount the REAL `ProjectBreadcrumb` and `MarkdownEditor`
// components together (not stand-ins) against the REAL
// `BreadcrumbProvider`/`useBreadcrumbExtra`, and verify each test goes RED
// against the pre-fix single-slot implementation by temporarily
// reintroducing it (see the comment above each `it` for how it was
// verified).

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BreadcrumbProvider,
  useBreadcrumbExtra,
} from "@/components/nav/breadcrumb-context";
import { ProjectBreadcrumb } from "@/components/project/project-breadcrumb";
import { MarkdownEditor } from "@/components/docs/markdown-editor";

let mockPathname = "/w/acme/projects/proj-1/docs/doc-1";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/actions/docs", () => ({
  updateDoc: vi.fn().mockResolvedValue({}),
  setDocKind: vi.fn(),
  setDocRelevantFrom: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/approvals/request-approval-dialog", () => ({
  RequestApprovalDialog: () => null,
}));

// jsdom in this repo's configuration has no window.localStorage — the
// docs assistant sidebar's open/closed state (F009) reads/writes it.
// Minimal in-memory implementation, scoped to this file (same pattern as
// tests/unit/f009-assistant-sidebar.test.tsx).
if (typeof window !== "undefined" && !window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => store.clear(),
    },
    configurable: true,
  });
}

function BreadcrumbReader() {
  const extra = useBreadcrumbExtra();
  return <span data-testid="crumbs">{extra.map((c) => c.label).join(" > ")}</span>;
}

const DOC_ID = "22222222-2222-4222-8222-222222222222";

function ProjectDocHarness() {
  return (
    <BreadcrumbProvider>
      <ProjectBreadcrumb
        workspaceSlug="acme"
        projectId="proj-1"
        projectName="Website Redesign"
      />
      <MarkdownEditor
        docId={DOC_ID}
        initialTitle="Kickoff notes"
        initialContent="# Hello"
      />
      <BreadcrumbReader />
    </BreadcrumbProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("F035: ProjectBreadcrumb and the docs editor compose instead of clobbering", () => {
  // Verified by mutation: with the pre-fix single-slot `useSetBreadcrumb`
  // (both callers writing the same `extra` array), this assertion goes
  // RED — the editor's later-running effect replaces the project crumb
  // entirely, leaving only "Kickoff notes".
  it("test_project_and_doc_crumbs_both_survive_when_mounted_together", async () => {
    render(<ProjectDocHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("crumbs")).toHaveTextContent(
        "Website Redesign > Kickoff notes",
      );
    });
  });

  // Verified by mutation: with the pre-fix shared-slot cleanup
  // (`setExtra([])` on ANY writer's unmount), this assertion goes RED —
  // unmounting the editor also wipes the still-mounted ProjectBreadcrumb's
  // crumb, leaving an empty string instead of "Website Redesign".
  it("test_project_crumb_survives_after_the_doc_editor_unmounts", async () => {
    const { rerender } = render(<ProjectDocHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("crumbs")).toHaveTextContent("Website Redesign");
    });

    rerender(
      <BreadcrumbProvider>
        <ProjectBreadcrumb
          workspaceSlug="acme"
          projectId="proj-1"
          projectName="Website Redesign"
        />
        <BreadcrumbReader />
      </BreadcrumbProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("crumbs")).toHaveTextContent("Website Redesign");
      expect(screen.getByTestId("crumbs")).not.toHaveTextContent("Kickoff notes");
    });
  });

  it("test_doc_editor_still_announces_its_title_with_no_project_breadcrumb_mounted", async () => {
    render(
      <BreadcrumbProvider>
        <MarkdownEditor
          docId={DOC_ID}
          initialTitle="Standalone doc"
          initialContent="# Hi"
        />
        <BreadcrumbReader />
      </BreadcrumbProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("crumbs")).toHaveTextContent("Standalone doc");
    });
  });
});

describe("F035 / AS-061: the assistant sidebar's context bar still gets the doc title alongside the project crumb", () => {
  it("test_sidebar_context_bar_shows_the_doc_title_when_a_project_crumb_is_also_registered", async () => {
    mockPathname = "/w/acme/projects/proj-1/docs/doc-1";

    const { AssistantSidebar, AssistantSidebarProvider, AssistantSidebarToggle } =
      await import("@/components/ai/assistant-sidebar");

    render(
      <BreadcrumbProvider>
        <AssistantSidebarProvider>
          <ProjectBreadcrumb
            workspaceSlug="acme"
            projectId="proj-1"
            projectName="Website Redesign"
          />
          <MarkdownEditor
            docId={DOC_ID}
            initialTitle="Kickoff notes"
            initialContent="# Hello"
          />
          <AssistantSidebarToggle />
          <AssistantSidebar workspaceId="w1" hasApiKey={true} />
        </AssistantSidebarProvider>
      </BreadcrumbProvider>,
    );

    fireEvent.click(screen.getByTestId("assistant-sidebar-toggle"));

    await waitFor(() => {
      expect(screen.getByTestId("assistant-sidebar")).toHaveTextContent(
        "Kickoff notes",
      );
    });
  });
});
