// F015 (SB-056): pure map from a legacy standalone route's tab name to its
// canonical Inbox tab query value. Each of the four old standalone pages
// (approvals/requests/watching/notifications) now does nothing but
// `permanentRedirect(legacyInboxRedirectPath(workspaceSlug, "<name>", searchParams))`
// — this map (and the query-string passthrough logic) is the one place
// that mapping lives, so it can be unit-tested without rendering a page.
export const LEGACY_INBOX_TAB: Record<
  "approvals" | "requests" | "watching" | "notifications",
  string
> = {
  approvals: "approvals",
  requests: "requests",
  watching: "watching",
  notifications: "notifications",
};

export type LegacyInboxRoute = keyof typeof LEGACY_INBOX_TAB;

/**
 * Builds the canonical Inbox URL a legacy standalone route redirects to,
 * preserving any extra search params the old URL carried (e.g. a deep link
 * with `?highlight=<id>`) alongside the new `tab` param.
 */
export function legacyInboxRedirectPath(
  workspaceSlug: string,
  route: LegacyInboxRoute,
  searchParams?: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  params.set("tab", LEGACY_INBOX_TAB[route]);

  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      if (key === "tab" || value === undefined) continue;
      if (Array.isArray(value)) {
        for (const v of value) params.append(key, v);
      } else {
        params.append(key, value);
      }
    }
  }

  return `/w/${workspaceSlug}/inbox?${params.toString()}`;
}
