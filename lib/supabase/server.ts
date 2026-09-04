// Server Component / Server Action Supabase client (cookie-based, RLS-respecting).
// Uses the new sb_publishable_* key format per tech-decisions.md — NOT the
// secret key. This is the client used by application logic; RLS is the
// authorization boundary. Next.js 16: cookies() is async-only.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// F024 (missions/20260903-portal, AS-052): "view the portal as a specific
// client" is implemented by minting a REAL session for that client
// (lib/actions/portal-preview.ts) and storing its access/refresh tokens
// in cookies scoped to `path: "/portal"`. Because of that path scoping,
// the browser only ever sends these two cookie names on a request to
// `/portal/*` — every request under `/w/*` (the team app) never has them
// in its Cookie header at all, so the branch below is unreachable there
// and this function's behavior for the rest of the app is byte-for-byte
// unchanged. This is what lets the entire portal route tree (every
// Server Component under app/(portal)/portal/[workspaceSlug]/**) render
// through the client's own RLS-backed session with NO changes to any of
// those components or queries — see this feature's spec section 2 for
// why a `previewAsClientId` query-parameter approach was rejected
// instead.
const PORTAL_PREVIEW_ACCESS_COOKIE = "portal_preview_access_token";
const PORTAL_PREVIEW_REFRESH_COOKIE = "portal_preview_refresh_token";

// F024b (missions/20260903-portal, AS-052/AS-053 remediation): the message
// shown by both layers of the preview write block below, and re-exported
// so `lib/auth/assert-not-preview.ts` (the RPC/comment-path guard) reports
// the identical string a caller of `.insert()/.update()/.upsert()/.delete()`
// under preview would see from Layer A here.
export const PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE =
  "You're previewing as a client. Actions are disabled in preview.";

// F024b: true whenever the request carries a live preview session --
// i.e. exactly the condition under which `createClient()` below returns
// the impersonated client instead of the caller's own. Exported so
// `signOut()` (lib/actions/auth.ts) and the shared Server Action guard
// (`lib/auth/assert-not-preview.ts`) can ask the same question this file
// answers for itself, without re-reading the raw cookie names in three
// places.
export async function isPortalPreview(): Promise<boolean> {
  const cookieStore = await cookies();
  const previewAccessToken = cookieStore.get(PORTAL_PREVIEW_ACCESS_COOKIE)?.value;
  const previewRefreshToken = cookieStore.get(PORTAL_PREVIEW_REFRESH_COOKIE)?.value;
  return Boolean(previewAccessToken && previewRefreshToken);
}

// F024b -- Layer A of the write block, structural and default-deny: ANY
// row-mutating call (`insert`/`update`/`upsert`/`delete`) issued through a
// preview-session client is refused, for every table, including ones no
// portal action touches yet. This is deliberately unconditional rather than
// an allow/deny list of table names, because a genuine client session is by
// construction a writing session (this feature's whole defect) and no
// legitimate *read* path ever calls one of these four methods -- so there
// is no case this blocks that should have been allowed. A future developer
// who adds a brand-new portal Server Action that does
// `supabase.from("whatever").insert(...)` is refused automatically, with no
// guard to remember.
//
// This does NOT cover `.rpc()`: several existing portal READ paths call
// read-only RPCs through this same client (e.g. `project_hours_client`,
// `get_open_task_counts` -- lib/queries/hours.ts, lib/queries/projects.ts),
// so blocking every RPC call here would break reads, and there is no
// structural signal (naming or otherwise) that reliably separates a read
// RPC from a write RPC. The RPC-calling and comment-posting write paths
// (`approvePortalTask`, `requestPortalTaskChanges`, `decideApproval`,
// `flagAssumption`, `deliverPortalDeliverable`, `addComment`) are instead
// covered by Layer B, the explicit `assertNotPreview()` guard each of those
// six actions calls first -- see that file's header for why an explicit,
// per-action call is the correct (and only honest) seam for those, and why
// this comment names the gap rather than papering over it.
function blockedPreviewWrite(): PromiseLike<{
  data: null;
  error: { message: string; code: string };
}> & Record<string, (...args: unknown[]) => unknown> {
  const settled = {
    data: null,
    error: {
      message: PORTAL_PREVIEW_ACTION_BLOCKED_MESSAGE,
      code: "PORTAL_PREVIEW_READ_ONLY",
    },
  };
  const chain = new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") {
          return (
            onFulfilled?: (value: typeof settled) => unknown,
          ) => Promise.resolve(onFulfilled ? onFulfilled(settled) : settled);
        }
        if (prop === "catch" || prop === "finally") {
          return () => chain;
        }
        // Any further chained call (.select(), .eq(), .single(), ...)
        // just returns the same blocked, still-awaitable chain, so a
        // caller shaped like `.insert(x).select().single()` or
        // `.delete().eq("id", id)` resolves to the same refusal no
        // matter how it continues the chain.
        return () => chain;
      },
    },
  ) as PromiseLike<typeof settled> & Record<string, (...args: unknown[]) => unknown>;
  return chain;
}

function wrapPreviewClientReadOnly<T extends ReturnType<typeof createServerClient>>(
  client: T,
): T {
  return new Proxy(client as unknown as object, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (relation: never) => {
          const builder = (
            (target as { from: (r: never) => unknown }).from
          )(relation);
          return new Proxy(builder as object, {
            get(builderTarget, builderProp, builderReceiver) {
              if (
                builderProp === "insert" ||
                builderProp === "update" ||
                builderProp === "upsert" ||
                builderProp === "delete"
              ) {
                return () => blockedPreviewWrite();
              }
              return Reflect.get(builderTarget, builderProp, builderReceiver);
            },
          });
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

// F024b: the previewer's own real, `/`-scoped team session -- deliberately
// ignores the preview cookies even when present, unlike `createClient()`
// below. Used where code must act (or audit) as the ACTUAL signed-in
// caller regardless of an active preview, e.g. the portal layout's
// per-entry audit write (AS-053) and `startClientPreview` itself.
export async function createRealSessionClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll called from a Server Component — safe to ignore because
            // proxy.ts refreshes the session on every request.
          }
        },
      },
    },
  );
}

export async function createClient() {
  const cookieStore = await cookies();

  const previewAccessToken = cookieStore.get(PORTAL_PREVIEW_ACCESS_COOKIE)?.value;
  const previewRefreshToken = cookieStore.get(PORTAL_PREVIEW_REFRESH_COOKIE)?.value;

  if (previewAccessToken && previewRefreshToken) {
    // A no-op cookie adapter deliberately: this client's session must
    // NEVER be persisted back into the browser's real cookies (that
    // would overwrite the previewer's own team session, or leak the
    // impersonated session outside `/portal`). `setSession` below only
    // sets this one request-scoped client instance's in-memory auth
    // state — nothing is written anywhere.
    const previewClient = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll: () => [],
          setAll: () => {},
        },
      },
    );
    await previewClient.auth.setSession({
      access_token: previewAccessToken,
      refresh_token: previewRefreshToken,
    });
    // F024b: see Layer A's comment above `blockedPreviewWrite` -- every
    // `.from(...).insert/update/upsert/delete(...)` issued through this
    // impersonated client is refused, unconditionally, before F024's
    // original defect (a real, unscoped client session reaching every
    // portal write path) can act.
    return wrapPreviewClientReadOnly(previewClient);
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll called from a Server Component — safe to ignore because
            // proxy.ts refreshes the session on every request.
          }
        },
      },
    },
  );
}
