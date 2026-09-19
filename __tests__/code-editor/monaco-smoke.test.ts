// F004 (TH-174, TH-175): smoke test confirming `configureMonaco()` points
// `@monaco-editor/react`'s loader at the locally-installed `monaco-editor`
// npm package -- not a CDN URL -- and that the loader module itself is
// imported from the `@monaco-editor/react` package (which re-exports the
// loader implementation living under its own `lib/` build output), never
// from a raw CDN string. Monaco's real editor cannot mount in jsdom (no
// web workers / canvas), so this test mounts the loader configuration path
// directly rather than a `<Editor />` component, matching the clarified
// "shallow mount assertion" shape from the feature spec.
import { describe, expect, it, vi, beforeEach } from "vitest";

const configMock = vi.fn();

vi.mock("@monaco-editor/react", () => ({
  loader: {
    config: configMock,
  },
}));

vi.mock("monaco-editor", () => ({
  __esModule: true,
  default: { __localMonacoPackage: true },
}));

describe("Monaco smoke test", () => {
  beforeEach(() => {
    vi.resetModules();
    configMock.mockClear();
  });

  it("test_TH_174_configureMonaco_mounts_without_console_errors", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      const { configureMonaco } = await import("../../lib/monaco-loader");

      expect(() => configureMonaco()).not.toThrow();

      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("test_TH_174_loader_config_called_with_object_containing_monaco_property", async () => {
    const { configureMonaco } = await import("../../lib/monaco-loader");

    configureMonaco();

    expect(configMock).toHaveBeenCalledTimes(1);
    const [callArg] = configMock.mock.calls[0];
    expect(callArg).toHaveProperty("monaco");
  });

  it("test_TH_175_monaco_property_is_the_local_npm_package_not_a_cdn_url", async () => {
    const monacoModule = await import("monaco-editor");
    const { configureMonaco } = await import("../../lib/monaco-loader");

    configureMonaco();

    const [callArg] = configMock.mock.calls[0];
    // The value passed is the imported local module object, not a string
    // (a CDN URL would be a `string` under a `paths.vs` key instead).
    expect(typeof callArg.monaco).not.toBe("string");
    expect(callArg.monaco).toBe(monacoModule);
    expect(callArg).not.toHaveProperty("paths");
  });

  it("test_TH_175_no_cdn_url_string_appears_anywhere_in_the_config_call", async () => {
    const { configureMonaco } = await import("../../lib/monaco-loader");

    configureMonaco();

    const [callArg] = configMock.mock.calls[0];
    const keys = Object.keys(callArg);
    const values = keys.map((key) => String(callArg[key]));

    expect(keys.join(",")).not.toMatch(/https?:\/\//);
    expect(values.join(",")).not.toMatch(/https?:\/\//);
    expect(keys.join(",")).not.toMatch(/cdn|jsdelivr|unpkg/i);
  });

  it("test_TH_175_calling_configureMonaco_twice_does_not_switch_to_a_cdn_config", async () => {
    const { configureMonaco } = await import("../../lib/monaco-loader");

    configureMonaco();
    configureMonaco();

    // Idempotency proper (config called exactly once on repeat calls with
    // no state change) is asserted in lib/monaco-loader.test.ts (F002,
    // TH-175); here we re-confirm that even across repeated invocations,
    // every call the loader receives still resolves to the local package,
    // never a CDN path.
    for (const [callArg] of configMock.mock.calls) {
      expect(callArg).toHaveProperty("monaco");
      expect(callArg).not.toHaveProperty("paths");
    }
  });

  it("test_TH_175_loader_module_is_imported_from_monaco_editor_react_package", async () => {
    // Static-analysis guard: `lib/monaco-loader.ts` must import `loader`
    // from the `@monaco-editor/react` package (which resolves the loader
    // to the locally-installed `monaco-editor` bundle), never from a raw
    // CDN URL string literal.
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.resolve(process.cwd(), "lib/monaco-loader.ts"),
      "utf-8",
    );

    expect(source).toMatch(/from\s+["']@monaco-editor\/react["']/);
    expect(source).not.toMatch(/https?:\/\//);
  });
});
