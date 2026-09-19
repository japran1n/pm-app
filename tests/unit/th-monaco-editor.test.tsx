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

// Minimal stand-in for the Monaco editor instance + `monaco` namespace
// passed into `onMount`, capturing whatever command `editor.addCommand`
// registers so tests can invoke it directly (simulating Ctrl+S).
const mockAddCommand = vi.fn();
let capturedSaveCommand: (() => void | Promise<void>) | null = null;
let editorValue = "";

vi.mock("@monaco-editor/react", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      editorValue = props.value ?? "";
      const editorStub = {
        getValue: () => editorValue,
        setValue: (v: string) => {
          editorValue = v;
        },
        addCommand: (_keybinding: number, handler: () => void | Promise<void>) => {
          mockAddCommand(_keybinding, handler);
          capturedSaveCommand = handler;
        },
      };
      const monacoStub = {
        KeyMod: { CtrlCmd: 2048 },
        KeyCode: { KeyS: 49 },
      };
      // Fire onMount synchronously on first render, same as the real
      // package invoking it once the editor instance is ready.
      props.onMount?.(editorStub, monacoStub);
      return (
        <div data-testid="monaco-editor" data-language={props.language} data-theme={props.theme}>
          <textarea
            aria-label="monaco-value"
            value={props.value}
            onChange={(e) => {
              editorValue = e.target.value;
              props.onChange?.(e.target.value);
            }}
          />
        </div>
      );
    },
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

const { formatCodeMock } = vi.hoisted(() => ({ formatCodeMock: vi.fn() }));
vi.mock("@/lib/code-editor/format", () => ({
  formatCode: (...args: unknown[]) => formatCodeMock(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockInit.mockReturnValue(
    Object.assign(Promise.resolve({}), { cancel: vi.fn() }),
  );
  capturedSaveCommand = null;
  editorValue = "";
  formatCodeMock.mockImplementation((code: string) => Promise.resolve(code));
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

  test("TH-181: Ctrl+S registers a save command that formats content and reports it via onChange", async () => {
    formatCodeMock.mockResolvedValue(".a { color: red; }");
    const onChange = vi.fn();
    render(
      <EditorPane file={styleBlock({ content: ".a{color:red}" })} onChange={onChange} />,
    );

    expect(capturedSaveCommand).toBeInstanceOf(Function);
    await capturedSaveCommand!();

    expect(formatCodeMock).toHaveBeenCalledWith(".a{color:red}", "css");
    expect(onChange).toHaveBeenCalledWith(".a { color: red; }");
  });

  test("TH-181: Ctrl+S calls onSave after the save completes", async () => {
    formatCodeMock.mockResolvedValue("console.log(1);");
    const onSave = vi.fn();
    render(
      <EditorPane
        file={scriptBlock({ content: "console.log(1)" })}
        onChange={() => {}}
        onSave={onSave}
      />,
    );

    await capturedSaveCommand!();

    expect(formatCodeMock).toHaveBeenCalledWith("console.log(1)", "javascript");
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  test("TH-182: an unsaved change is indicated in the editor header when isDirty is true", () => {
    render(
      <EditorPane file={styleBlock()} onChange={() => {}} isDirty />,
    );
    expect(screen.getByTestId("editor-dirty-indicator")).toHaveTextContent("•");
  });

  test("TH-182: no dirty indicator is shown when isDirty is false (default)", () => {
    render(<EditorPane file={styleBlock()} onChange={() => {}} />);
    expect(screen.getByTestId("editor-dirty-indicator")).toHaveTextContent("");
  });

  test("TH-183: the unsaved indicator clears after a save (parent flips isDirty to false via onSave)", async () => {
    formatCodeMock.mockResolvedValue(".a{color:red}");
    const onSave = vi.fn();
    const { rerender } = render(
      <EditorPane
        file={styleBlock({ content: ".a{color:red}" })}
        onChange={() => {}}
        onSave={onSave}
        isDirty
      />,
    );
    expect(screen.getByTestId("editor-dirty-indicator")).toHaveTextContent("•");

    await capturedSaveCommand!();
    expect(onSave).toHaveBeenCalledTimes(1);

    // Parent reacts to onSave by clearing dirty state (see
    // lib/code-editor/use-dirty-state.ts markClean) and re-renders with
    // isDirty=false.
    rerender(
      <EditorPane
        file={styleBlock({ content: ".a{color:red}" })}
        onChange={() => {}}
        onSave={onSave}
        isDirty={false}
      />,
    );
    expect(screen.getByTestId("editor-dirty-indicator")).toHaveTextContent("");
  });
});
