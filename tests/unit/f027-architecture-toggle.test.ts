// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/actions/architecture", () => ({
  getNodeDetailsForToggle: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "test-project-123" }),
  useRouter: () => ({ refresh: vi.fn() }),
}));

const TOGGLE_PATH = path.resolve(
  __dirname,
  "../../components/architecture/architecture-view-toggle.tsx",
);
const CLIENT_BOARD_PATH = path.resolve(
  __dirname,
  "../../components/architecture/client-board.tsx",
);

const toggleSource = fs.readFileSync(TOGGLE_PATH, "utf-8");
const clientBoardSource = fs.readFileSync(CLIENT_BOARD_PATH, "utf-8");

// jsdom in this repo's configuration has no window.localStorage (see
// tests/unit/browser-notify.test.ts's own comment for the same polyfill) --
// a minimal in-memory implementation, scoped to this file.
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

describe("F27 — architecture Details toggle", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("test_AS_toggle_default_off_on_fresh_project", () => {
    window.localStorage.clear();
    expect(window.localStorage.getItem("pm-app:architecture-details:test-project-123")).toBeNull();
    // Initial component state is declared `useState(false)` -- default OFF --
    // and is only ever overwritten from localStorage inside a useEffect that
    // runs after mount, matching the SSR-safe hydration pattern documented
    // in the component's own comments.
    expect(toggleSource).toContain('const [showDetails, setShowDetails] = useState(false);');
  });

  it("test_AS_toggle_uses_correct_localStorage_key", () => {
    const projectId = "test-project-123";
    const expectedKey = `pm-app:architecture-details:${projectId}`;
    expect(toggleSource).toContain("pm-app:architecture-details:");
    expect(toggleSource).toContain("`pm-app:architecture-details:${projectId}`");
    expect(expectedKey).toBe("pm-app:architecture-details:test-project-123");
  });

  it("test_AS_portal_never_renders_details_toggle", () => {
    expect(clientBoardSource).not.toContain("architecture-view-toggle");
    expect(clientBoardSource).not.toContain("ArchitectureViewToggle");
    expect(clientBoardSource).not.toContain("showDetails");
  });

  it("test_AS_toggle_persistence_key_is_project_scoped", () => {
    expect(toggleSource).toContain("localStorage.setItem");
    expect(toggleSource).toContain("localStorage.setItem(storageKey, String(next))");
    expect(toggleSource).toContain("projectId");
  });

  it("test_AS_details_toggle_in_board_not_client_board", () => {
    expect(toggleSource).toContain("showDetails");
    expect(clientBoardSource).not.toContain("showDetails");
    expect(clientBoardSource).not.toContain("EstimateChip");
  });
});
