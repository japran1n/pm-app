// F102 (TH-292, TH-293) — client-side fetch orchestration for the Webflow
// Code Editor tool.
//
// Calls /api/webflow-source, extracts style/script blocks, and (best
// effort) builds the autocomplete corpus. A failed fetch sets `error` and
// leaves any previously loaded `blocks`/`html`/`corpus`/`finalUrl` intact --
// the workspace must never blank out on a failed re-fetch (round 1 Q11(b)).

"use client";

import { useCallback, useState } from "react";
import {
  extractScriptBlocks,
  extractStyleBlocks,
  type ScriptBlock,
  type StyleBlock,
} from "./extract";
import type { Corpus } from "./corpus";

export type Block = StyleBlock | ScriptBlock;

export interface FetchSiteState {
  loading: boolean;
  error: string | null;
  blocks: Block[];
  corpus: Corpus | null;
  html: string | null;
  finalUrl: string | null;
}

const INITIAL_STATE: FetchSiteState = {
  loading: false,
  error: null,
  blocks: [],
  corpus: null,
  html: null,
  finalUrl: null,
};

const DEFAULT_ERROR = "Failed to fetch site";

export function useFetchSite(): {
  state: FetchSiteState;
  fetchSite: (url: string) => Promise<void>;
} {
  const [state, setState] = useState<FetchSiteState>(INITIAL_STATE);

  const fetchSite = useCallback(async (url: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    let response: Response;
    try {
      response = await fetch(
        `/api/webflow-source?url=${encodeURIComponent(url)}`,
        { credentials: "include" },
      );
    } catch {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: DEFAULT_ERROR,
      }));
      return;
    }

    if (!response.ok) {
      let message = DEFAULT_ERROR;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) {
          message = body.error;
        }
      } catch {
        // no JSON body -- fall back to the default message
      }
      setState((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
      return;
    }

    const { html, finalUrl } = (await response.json()) as {
      html: string;
      finalUrl: string;
    };

    const blocks: Block[] = [
      ...extractStyleBlocks(html),
      ...extractScriptBlocks(html),
    ];

    let corpus: Corpus | null = null;
    try {
      const corpusModule = await import("./corpus");
      corpus = corpusModule.buildCorpus(html);
    } catch {
      corpus = null;
    }

    setState({
      loading: false,
      error: null,
      blocks,
      corpus,
      html,
      finalUrl,
    });
  }, []);

  return { state, fetchSite };
}
