// F024/F024b (missions/20260903-portal, AS-052, AS-053): plain constants
// module, deliberately with no "use server" directive and no imports of its
// own.
//
// Why this file exists: a "use server" module may only export async
// functions -- plain value exports make Next.js reject the whole module,
// collapsing every export (including the real Server Actions) to nothing.
// `lib/actions/portal-preview.ts` used to export these cookie names
// directly, which also created a real import cycle with
// `lib/supabase/server.ts` (which needs the cookie names to detect an
// in-progress preview, and `portal-preview.ts` imports
// `createRealSessionClient` from that same file). Hoisting the constants
// here, with zero imports, breaks both problems at once.
//
// Do not change these string values: they are live cookie names. Renaming
// one silently logs out anyone mid-preview session.
export const PORTAL_PREVIEW_ACCESS_COOKIE = "portal_preview_access_token";
export const PORTAL_PREVIEW_REFRESH_COOKIE = "portal_preview_refresh_token";
export const PORTAL_PREVIEW_LABEL_COOKIE = "portal_preview_client_label";
// F024b (AS-053): the previewed client's own `workspace_members.id`, stored
// so the portal layout's per-entry audit write (AS-053's "every entry into
// the client-preview view") can target the same row this action's own
// start-of-preview entry does, without an extra DB round-trip on every
// portal navigation just to re-derive it.
export const PORTAL_PREVIEW_CLIENT_MEMBER_COOKIE = "portal_preview_client_member_id";
