// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CodeEditorPage } from "@/components/code-editor/code-editor-page";

afterEach(() => {
  cleanup();
});

describe("CodeEditorPage URL form", () => {
  // TH-291
  test("TH_291_valid_webflow_io_url_calls_onFetch", async () => {
    const user = userEvent.setup();
    const onFetch = vi.fn();
    render(<CodeEditorPage onFetch={onFetch} />);

    const input = screen.getByPlaceholderText("https://yoursite.webflow.io");
    await user.type(input, "https://mysite.webflow.io");
    await user.click(screen.getByRole("button", { name: /fetch site/i }));

    expect(onFetch).toHaveBeenCalledWith("https://mysite.webflow.io");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  // TH-291 / TH-294
  test("TH_291_non_webflow_url_is_rejected_client_side", async () => {
    const user = userEvent.setup();
    const onFetch = vi.fn();
    render(<CodeEditorPage onFetch={onFetch} />);

    const input = screen.getByPlaceholderText("https://yoursite.webflow.io");
    await user.type(input, "https://example.com");
    await user.click(screen.getByRole("button", { name: /fetch site/i }));

    expect(onFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please enter a valid .webflow.io URL",
    );
  });

  // TH-294
  test("TH_294_invalid_url_shows_inline_error_message", async () => {
    const user = userEvent.setup();
    render(<CodeEditorPage onFetch={vi.fn()} />);

    const input = screen.getByPlaceholderText("https://yoursite.webflow.io");
    await user.type(input, "not-a-url");
    await user.click(screen.getByRole("button", { name: /fetch site/i }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Please enter a valid .webflow.io URL",
    );
  });

  // TH-294 negative: lookalike host (SSRF-style suffix trick) still rejected
  test("TH_294_lookalike_host_is_rejected", async () => {
    const user = userEvent.setup();
    const onFetch = vi.fn();
    render(<CodeEditorPage onFetch={onFetch} />);

    const input = screen.getByPlaceholderText("https://yoursite.webflow.io");
    await user.type(input, "https://webflow.io.evil.com");
    await user.click(screen.getByRole("button", { name: /fetch site/i }));

    expect(onFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  // TH-295
  test("TH_295_submit_button_disabled_when_input_empty", () => {
    render(<CodeEditorPage onFetch={vi.fn()} />);
    expect(screen.getByRole("button", { name: /fetch site/i })).toBeDisabled();
  });

  // TH-295
  test("TH_295_form_disabled_and_shows_fetching_label_during_fetch", () => {
    render(<CodeEditorPage onFetch={vi.fn()} isFetching />);

    const input = screen.getByPlaceholderText("https://yoursite.webflow.io");
    const button = screen.getByRole("button", { name: /fetching/i });

    expect(input).toBeDisabled();
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent("Fetching...");
  });

  // TH-290
  test("TH_290_empty_state_shown_before_first_fetch", () => {
    render(<CodeEditorPage onFetch={vi.fn()} />);

    expect(
      screen.getByText("Enter a Webflow URL to start editing"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Paste your .webflow.io staging URL above to load the site's CSS and JavaScript.",
      ),
    ).toBeInTheDocument();
  });

  // TH-290
  test("TH_290_empty_state_hidden_once_site_is_loaded", () => {
    render(<CodeEditorPage onFetch={vi.fn()} hasSite />);

    expect(
      screen.queryByText("Enter a Webflow URL to start editing"),
    ).not.toBeInTheDocument();
  });

  // TH-292 / TH-293 — without an `onFetch` override, the component
  // orchestrates its own fetch via useFetchSite and surfaces the result.
  describe("without onFetch override (internal useFetchSite orchestration)", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    // TH-292
    test("TH_292_successful_fetch_hides_empty_state", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            html: "<html><head><style>.a{}</style></head><body></body></html>",
            finalUrl: "https://mysite.webflow.io",
          }),
        }),
      );

      render(<CodeEditorPage />);

      const input = screen.getByPlaceholderText("https://yoursite.webflow.io");
      await user.type(input, "https://mysite.webflow.io");
      await user.click(screen.getByRole("button", { name: /fetch site/i }));

      await waitFor(() => {
        expect(
          screen.queryByText("Enter a Webflow URL to start editing"),
        ).not.toBeInTheDocument();
      });
    });

    // TH-293
    test("TH_293_failed_fetch_shows_error_message_in_ui", async () => {
      const user = userEvent.setup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: false,
          json: async () => ({ error: "Site not reachable" }),
        }),
      );

      render(<CodeEditorPage />);

      const input = screen.getByPlaceholderText("https://yoursite.webflow.io");
      await user.type(input, "https://mysite.webflow.io");
      await user.click(screen.getByRole("button", { name: /fetch site/i }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Site not reachable",
      );
    });
  });
});
