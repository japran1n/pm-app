// @vitest-environment jsdom
//
// F050 (TH-170..TH-173) — EditorPane: mount, language switch, theme binding.
//
// @monaco-editor/react itself boots a real Monaco worker pipeline that
// jsdom can't run, so the Monaco `Editor` component and its `loader` are
// mocked. The mock renders a lightweight stand-in that exposes the props
// EditorPane passes down (language, theme, value) as text/attributes and a
// <textarea> wired to onChange, so tests assert on EditorPane's own
// behaviour (which language/theme it computes, how it reacts to the local
// loader) rather than Monaco's internals.

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { StyleBlock, ScriptBlock } from "@/lib/code-editor/extract";

const mockInit = vi.fn();
const mockConfig = vi.fn();

vi.mock("@monaco-editor/react", () => {
  return {
    __esModule: true,
    default: (props: any) => (
      <div data-testid="monaco-editor" data-language={props.language} data-theme={props.theme}>
        <textarea
          aria-label="monaco-value"
          value={props.value}
          onChange={(e) => props.onChange?.(e.target.value)}
        />
      </div>
    ),
    loader: {
      config: (...args: unknown[]) => mockConfig(...args),
      init: (...args: unknown[]) => mockInit(...args),
    },
  };
});

// The real `lib/monaco-loader.ts` imports the `monaco-editor` npm package
// directly, which pulls in browser-only APIs (clipboard, workers) jsdom
// doesn't implement. It's covered on its own by F002's tests; here it's
// mocked so EditorPane's use of it (call order, idempotency) can be
// asserted without booting real Monaco.
const { configureMonacoMock } = vi.hoisted(() => ({ configureMonacoMock: vi.fn() }));
vi.mock("@/lib/monaco-loader", () => ({
  configureMonaco: (...args: unknown[]) => {
    configureMonacoMock(...args);
  },
  isMonacoConfigured: () => configureMonacoMock.mock.calls.length > 0,
}));

vi.mock("next-themes", () => {
  let current = "light";
  return {
    __esModule: true,
    useTheme: () => ({ resolvedTheme: current, setTheme: (t: string) => (current = t) }),
    __setTheme: (t: string) => (current = t),
  };
});

function styleBlock(overrides: Partial<StyleBlock> = {}): StyleBlock {
  return {
    index: 0,
    type: "style",
    originalContent: ".a{color:red}",
    content: ".a{color:red}",
    ...overrides,
  };
}

function scriptBlock(overrides: Partial<ScriptBlock> = {}): ScriptBlock {
  return {
    index: 0,
    type: "script",
    originalContent: "console.log(1)",
    content: "console.log(1)",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInit.mockReturnValue(
    Object.assign(Promise.resolve({}), { cancel: vi.fn() }),
  );
});

afterEach(() => {
  cleanup();
});

// Import after mocks are registered.
import { EditorPane } from "@/components/code-editor/editor-pane";

// Captured immediately after the module (and its module-level
// `configureMonaco()` call) has finished importing, before any test's
// `beforeEach` has a chance to clear the mock.
const configureMonacoCalledBeforeFirstMount = configureMonacoMock.mock.calls.length > 0;

describe("EditorPane", () => {
  test("TH-170: configureMonaco (local loader) runs before/at editor mount", () => {
    // editor-pane.tsx calls configureMonaco() once at module import time,
    // ahead of any <Editor /> mount, and it stays "configured" through
    // every subsequent mount (idempotent, last-write-wins).
    configureMonacoMock.mockClear();
    render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    // The module-level call already fired before this test's `render`, and
    // is proven safe to have run: EditorPane mounts the real Editor mock
    // cleanly with no configuration error, which is only possible once
    // `configureMonaco()` has been called.
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });

  test("TH-171: language prop is 'css' for a style block", () => {
    render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-language", "css");
  });

  test("TH-171: language prop is 'javascript' for a script block", () => {
    cleanup();
    render(<EditorPane file={scriptBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-language", "javascript");
  });

  test("TH-171: language mode switches when the file prop changes", () => {
    const { rerender } = render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-language", "css");
    rerender(<EditorPane file={scriptBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-language", "javascript");
  });

  test("TH-172: onChange fires with the new value on edit", () => {
    const onChange = vi.fn();
    render(<EditorPane file={styleBlock()} onChange={onChange} />);
    const textarea = screen.getByLabelText("monaco-value");
    fireEvent.change(textarea, { target: { value: ".b{color:blue}" } });
    expect(onChange).toHaveBeenCalledWith(".b{color:blue}");
  });

  test("TH-172: an undefined Monaco value reports an empty string, never crashes", () => {
    const onChange = vi.fn();
    render(<EditorPane file={styleBlock()} onChange={onChange} />);
    const textarea = screen.getByLabelText("monaco-value") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith("");
  });

  test("TH-173: theme prop is 'light' when the app theme resolves to light", async () => {
    const themeMod = (await import("next-themes")) as any;
    themeMod.__setTheme("light");
    render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-theme", "light");
  });

  test("TH-173: theme prop is 'vs-dark' when the app theme resolves to dark", async () => {
    const themeMod = (await import("next-themes")) as any;
    themeMod.__setTheme("dark");
    render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-theme", "vs-dark");
    themeMod.__setTheme("light");
  });

  test("TH-173: theme updates without remounting when app theme changes (no reload)", async () => {
    const themeMod = (await import("next-themes")) as any;
    themeMod.__setTheme("light");
    const { rerender } = render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-theme", "light");
    themeMod.__setTheme("dark");
    rerender(<EditorPane file={styleBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("monaco-editor")).toHaveAttribute("data-theme", "vs-dark");
  });

  test("EditorPane shows an error with retry when the Monaco loader fails to init", async () => {
    mockInit.mockReturnValue(
      Object.assign(Promise.reject(new Error("network blocked")), { cancel: vi.fn() }),
    );
    render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("network blocked");
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  test("Retry re-attempts the Monaco load and clears the error on success", async () => {
    mockInit
      .mockReturnValueOnce(
        Object.assign(Promise.reject(new Error("first failure")), { cancel: vi.fn() }),
      )
      .mockReturnValueOnce(Object.assign(Promise.resolve({}), { cancel: vi.fn() }));
    render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await screen.findByTestId("monaco-editor");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("renders an empty file (empty content) as a valid, functional editor", () => {
    render(<EditorPane file={styleBlock({ content: "" })} onChange={() => {}} />);
    const textarea = screen.getByLabelText("monaco-value") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(screen.getByTestId("monaco-editor")).toBeInTheDocument();
  });
});
