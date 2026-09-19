"use client";

// F100 (TH-006): placeholder shell for the Webflow Code Editor tool.
// F101 (TH-291, TH-294, TH-295): URL form with client-side .webflow.io
// validation, submitted via the `onFetch` prop -- actual fetch
// orchestration lands in F102.
// F103 (TH-290): empty state shown before a site is loaded (before any
// blocks are available).

import { useState } from "react";
import { Code2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFetchSite } from "@/lib/code-editor/use-fetch-site";
import { clearEditorState } from "@/lib/webflow-editor/storage";

const INVALID_URL_ERROR = "Please enter a valid .webflow.io URL";

// Client-side mirror of `isWebflowHost` (lib/site-preview/guards.ts):
// https + hostname's last two labels are exactly "webflow.io". This is a
// convenience check only -- the server route re-validates on submit, so it
// is intentionally not imported from server-only guard code.
export function isWebflowUrlClient(input: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") {
    return false;
  }

  const labels = parsed.hostname.split(".");
  if (labels.length < 2) {
    return false;
  }

  const lastTwo = labels.slice(-2);
  return lastTwo[0] === "webflow" && lastTwo[1] === "io";
}

export interface CodeEditorPageProps {
  /** Called with the validated URL when the form is submitted. */
  onFetch?: (url: string) => void;
  /** True while a fetch orchestrated by the parent is in flight. */
  isFetching?: boolean;
  /** True once a site's blocks are loaded -- hides the empty state. */
  hasSite?: boolean;
  /** Hostname of the currently loaded site (F089 storage key). */
  activeHostname?: string | null;
  /** Called after the stored state for `activeHostname` has been cleared. */
  onCleared?: (hostname: string) => void;
  /**
   * Injectable confirm dialog, defaults to `window.confirm`. Exists so
   * tests can control the confirmation outcome deterministically.
   */
  confirmFn?: (message: string) => boolean;
}

export function CodeEditorPage({
  onFetch,
  isFetching: isFetchingProp,
  hasSite: hasSiteProp,
  activeHostname = null,
  onCleared,
  confirmFn,
}: CodeEditorPageProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // F102 (TH-292, TH-293): when the caller doesn't supply its own
  // `onFetch`/`isFetching`/`hasSite` (e.g. tests exercising the form in
  // isolation), the component orchestrates the fetch itself via
  // `useFetchSite`. A failing fetch surfaces `fetchState.error` without
  // blanking any previously loaded blocks/html.
  const { state: fetchState, fetchSite } = useFetchSite();

  const isFetching = isFetchingProp ?? fetchState.loading;
  const hasSite = hasSiteProp ?? fetchState.blocks.length > 0;
  const fetchError = onFetch ? null : fetchState.error;

  function handleClearSavedState() {
    if (!activeHostname) return;

    const confirm =
      confirmFn ??
      (typeof window !== "undefined" ? window.confirm.bind(window) : () => true);

    const confirmed = confirm(
      `Clear saved data for "${activeHostname}"? This cannot be undone.`,
    );
    if (!confirmed) return;

    clearEditorState(activeHostname);
    onCleared?.(activeHostname);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = url.trim();

    if (!isWebflowUrlClient(trimmed)) {
      setError(INVALID_URL_ERROR);
      return;
    }

    setError(null);
    if (onFetch) {
      onFetch(trimmed);
    } else {
      void fetchSite(trimmed);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-base font-medium text-foreground">Webflow Code Editor</h1>
        <p className="text-sm text-muted-foreground">
          Fetch a Webflow staging site&apos;s CSS and JavaScript to edit in place.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Input
            type="text"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
            placeholder="https://yoursite.webflow.io"
            disabled={isFetching}
            aria-label="Webflow site URL"
            aria-invalid={error ? true : undefined}
            className="max-w-md"
          />
          <Button type="submit" variant="primary" disabled={url.trim().length === 0 || isFetching}>
            {isFetching ? "Fetching..." : "Fetch Site"}
          </Button>
          {activeHostname ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleClearSavedState}
            >
              Clear saved state
            </Button>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {!error && fetchError ? (
          <p role="alert" className="text-sm text-destructive">
            {fetchError}
          </p>
        ) : null}
      </form>

      {!hasSite ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-border py-16 text-center">
          <Code2 className="size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-sm font-medium text-foreground">
            Enter a Webflow URL to start editing
          </h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Paste your .webflow.io staging URL above to load the site&apos;s CSS and JavaScript.
          </p>
        </div>
      ) : null}
    </div>
  );
}
