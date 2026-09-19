// F002 (TH-175): `configureMonaco()` must point `@monaco-editor/react`'s
// loader at the locally-installed `monaco-editor` package so it never
// falls back to fetching the runtime from the jsdelivr CDN.
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

describe("configureMonaco", () => {
  beforeEach(() => {
    vi.resetModules();
    configMock.mockClear();
  });

  it("test_TH_175_configures_loader_with_local_monaco_package", async () => {
    const monacoModule = await import("monaco-editor");
    const { configureMonaco } = await import("./monaco-loader");

    configureMonaco();

    expect(configMock).toHaveBeenCalledTimes(1);
    const [callArg] = configMock.mock.calls[0];
    expect(callArg).toHaveProperty("monaco");
    // The value passed must be the local npm package module, not a URL —
    // the CDN path (`loader.config({ paths: { vs: "https://cdn..." } })`)
    // is never exercised by this call.
    expect(callArg.monaco).toBe(monacoModule);
    expect(callArg).not.toHaveProperty("paths");
  });

  it("test_TH_175_never_configures_a_cdn_path", async () => {
    const { configureMonaco } = await import("./monaco-loader");

    configureMonaco();

    const [callArg] = configMock.mock.calls[0];
    // The only key ever passed is `monaco` (the local package). No `paths`
    // key — that's the shape `loader.config` needs to hit a CDN URL.
    expect(Object.keys(callArg)).toEqual(["monaco"]);
  });

  it("test_TH_175_config_call_is_idempotent_across_repeated_invocations", async () => {
    const { configureMonaco, isMonacoConfigured } = await import(
      "./monaco-loader"
    );

    expect(isMonacoConfigured()).toBe(false);

    configureMonaco();
    configureMonaco();
    configureMonaco();

    expect(configMock).toHaveBeenCalledTimes(3);
    expect(isMonacoConfigured()).toBe(true);
  });
});
