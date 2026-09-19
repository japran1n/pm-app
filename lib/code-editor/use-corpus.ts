// F054 (TH-180) — React hook that memoizes the autocomplete corpus built
// from a site's HTML, only rebuilding when `html` itself changes (identity
// via useMemo's dependency array, not a manual reset flag — callers that
// need reset-on-hostname-change semantics compose this with
// `shouldResetCorpus` at the point where they decide to refetch/replace the
// tracked `html` value).

import { useMemo } from 'react';
import { buildCorpus, type Corpus } from './corpus';

const EMPTY_CORPUS: Corpus = { classes: [], cssVars: [], dataAttrs: [] };

/**
 * Builds (and memoizes) the autocomplete corpus for `html`. Returns an
 * empty corpus when `html` is empty/falsy, without invoking `buildCorpus`.
 */
export function useCorpus(html: string): Corpus {
  return useMemo(() => {
    if (!html) {
      return EMPTY_CORPUS;
    }
    return buildCorpus(html);
  }, [html]);
}
