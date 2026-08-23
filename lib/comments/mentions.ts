// F204 (AS-376): server-side enforcement that a stored comment's @-mention
// nodes only ever reference a user who is actually visible to the
// commenter on the task's owning project.
//
// F203 built the client-side picker (components/editor/mention-extension.ts)
// against `comment-list.tsx`'s already-fetched `members` prop — the full
// list of *active workspace members*, not narrowed to this specific
// project's visibility. That's fine as a suggestion source (nothing in the
// picker is a security boundary — see rich-text-editor.tsx's own
// sanitiseDocument doc comment: "never trusted just because it came from
// our own database"), but it means a hand-crafted `bodyJson` payload (any
// raw fetch/devtools call to addComment/editComment, bypassing the picker
// entirely) could reference ANY user id, including one who has no
// access to this project at all (e.g. a private project's owner-only
// visibility, or a user who was never added to the project). This module is
// the one place that closes that gap — re-checked on every write,
// independent of anything the client sent.
//
// Visibility rule mirrors `public.is_project_visible_to()`
// (supabase/migrations/20260821140526_project_visibility_rls_sweep.sql)
// exactly, generalised from "is the project visible to auth.uid()" (the SQL
// function's fixed caller) to "is the project visible to this specific
// mentioned user id" — the same generalisation pattern
// lib/actions/project-members.ts's `isProjectLeadOrWorkspaceAdmin` already
// uses for its own per-user, admin-client-driven re-derivation of an RLS
// helper. A mentioned user is visible when they are an active workspace
// member AND (the project is workspace-visible, OR they are a workspace
// owner/admin, OR they have an explicit project_members row for this
// project).
//
// Enforcement is "strip", not "reject the whole comment" (the clarified
// spec's Notes left this open; the simpler option that adds no new
// dependency and doesn't throw away an otherwise-valid comment over one bad
// mention was chosen — see this feature's handoff, Decisions made) — the
// disallowed mention node is replaced with a plain text node so the rest of
// the comment still posts.

import type { JSONContent } from "@tiptap/react";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * F301 (AS-374, AS-375, AS-381, AS-384 follow-up; scrutiny finding D5):
 * thrown by `resolveVisibleMentionIds` when either underlying Supabase
 * query fails. Previously this failure was silently swallowed (only
 * `data` was destructured, never `error`), so a transient DB error made
 * every mentioned id look "not visible" and every mention in the write
 * got permanently rewritten to the literal string "@Former member" — a
 * silent, irreversible document corruption. A typed error lets callers
 * (`sanitiseMentionsForVisibility`'s own callers, `addComment`/
 * `editComment`/`editTask`) distinguish "this write's mentions really
 * are all invisible" (empty Set, no error) from "we couldn't tell, so
 * don't touch the document" (this error) and fail the write instead of
 * corrupting it — per this mission's "lib stays pure/typed-error, the
 * calling Server Action decides how to surface it" convention.
 */
export class MentionVisibilityCheckError extends Error {
  constructor(cause: unknown) {
    super("Failed to resolve mention visibility (DB read failed)");
    this.name = "MentionVisibilityCheckError";
    this.cause = cause;
  }
}

/** Walks a Tiptap JSONContent tree collecting every `mention` node's
 * `attrs.id`. Mirrors the same recursive-walk shape as
 * `sanitiseNode`/`sanitiseDocument` in rich-text-editor.tsx, but read-only
 * (collect, don't rebuild) since this only needs to know which ids are
 * referenced, not re-validate node/mark shape (that's sanitiseDocument's
 * job on every render, independently, regardless of what's stored). */
function collectMentionIds(node: unknown, into: Set<string>): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type?: unknown; attrs?: Record<string, unknown>; content?: unknown[] };
  if (n.type === "mention" && typeof n.attrs?.id === "string" && n.attrs.id) {
    into.add(n.attrs.id);
  }
  if (Array.isArray(n.content)) {
    for (const child of n.content) collectMentionIds(child, into);
  }
}

/** Rebuilds a document, replacing every `mention` node whose id is not in
 * `visibleIds` with a plain text node — the same "removed/inaccessible
 * user" wording the renderer (mention-extension.ts's resolveMentionDisplay,
 * AS-377) uses, so the stored fallback text matches what a reader who
 * later loses visibility to this same user would see anyway. Any other
 * node/mark is passed through unchanged (this function does not
 * re-implement sanitiseDocument's allow-list — that remains the single
 * render-time security boundary; this only targets mention nodes). */
function stripInvisibleMentions(
  node: unknown,
  visibleIds: Set<string>,
): unknown {
  if (!node || typeof node !== "object") return node;
  const n = node as {
    type?: unknown;
    attrs?: Record<string, unknown>;
    content?: unknown[];
    [key: string]: unknown;
  };

  if (n.type === "mention") {
    const id = n.attrs?.id;
    if (typeof id === "string" && id && !visibleIds.has(id)) {
      return { type: "text", text: "@Former member" };
    }
    return node;
  }

  if (Array.isArray(n.content)) {
    return {
      ...n,
      content: n.content.map((child) => stripInvisibleMentions(child, visibleIds)),
    };
  }

  return node;
}

/**
 * F320 (AS-376 follow-up, scrutiny pass 5): safe conservative fallback for
 * batch/multi-document callers (currently only
 * `createProjectFromTemplate`'s post-RPC pass in lib/actions/templates.ts)
 * that cannot fail the whole write when `sanitiseMentionsForVisibility`
 * throws `MentionVisibilityCheckError` for one document in a batch (the
 * RPC that created the batch already committed atomically — there is
 * nothing left to roll back for the OTHER documents in the same batch, so
 * aborting the whole loop is not an option the way it is for a
 * single-document write like `addComment`/`editComment`/`editTask`).
 * Leaving that one document's original, unsanitised description in place
 * on a check failure would silently reintroduce the exact
 * mention-visibility hole this module exists to close. This strips every
 * mention node unconditionally (the same "@Former member" fallback text
 * `stripInvisibleMentions` already uses for an individual invisible
 * mention) — safe because it can never under-strip, only over-strip
 * (losing mention formatting on a mention that might actually have been
 * visible, in the rare case the visibility check itself failed
 * transiently) — and is not a substitute for `sanitiseMentionsForVisibility`
 * on the primary/common-case path, only a last-resort fallback after that
 * call has already thrown.
 */
export function stripAllMentions(doc: JSONContent): JSONContent {
  return stripInvisibleMentions(doc, new Set<string>()) as JSONContent;
}

/** Generalisation of `public.is_project_visible_to()` for an arbitrary
 * mentioned user id rather than `auth.uid()` — see this file's doc comment.
 * Batched (one workspace_members query + one project_members query for the
 * whole set of mentioned ids), not one query per id, per this project's
 * performance budget (no N+1).
 *
 * Exported (rather than kept module-private) so this is the single place
 * the "who's visible" rule is defined — this follow-up feature
 * (AS-376's "not offered in the picker" half) reuses it directly from
 * `lib/actions/comments.ts`'s `getMentionCandidates` to narrow the
 * client-side suggestion list to the same set of ids this function would
 * keep, rather than reimplementing the rule a second time. See this file's
 * top doc comment and this feature's handoff. */
export async function resolveVisibleMentionIds(
  admin: AdminClient,
  ids: string[],
  {
    projectId,
    workspaceId,
    projectVisibility,
  }: { projectId: string; workspaceId: string; projectVisibility: string },
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const { data: memberRows, error: memberError } = await admin
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .in("user_id", ids);

  if (memberError) {
    throw new MentionVisibilityCheckError(memberError);
  }

  const activeRoleById = new Map<string, string>(
    (memberRows ?? []).map((row) => [row.user_id as string, row.role as string]),
  );

  const visible = new Set<string>();
  const needsProjectMembership: string[] = [];

  for (const id of ids) {
    const role = activeRoleById.get(id);
    if (!role) continue; // not even an active workspace member — never visible
    if (projectVisibility === "workspace" || role === "owner" || role === "admin") {
      visible.add(id);
    } else {
      needsProjectMembership.push(id);
    }
  }

  if (needsProjectMembership.length > 0) {
    const { data: projectMemberRows, error: projectMemberError } = await admin
      .from("project_members")
      .select("user_id")
      .eq("project_id", projectId)
      .in("user_id", needsProjectMembership);

    if (projectMemberError) {
      throw new MentionVisibilityCheckError(projectMemberError);
    }

    for (const row of projectMemberRows ?? []) {
      visible.add(row.user_id as string);
    }
  }

  return visible;
}

/**
 * AS-376: re-validates every mention node in `doc` against the mentioned
 * user's real, server-side project visibility — independent of whatever
 * suggestion list the client used (or bypassed). Any mention referencing a
 * user who is not visible to the commenter on this project is stripped to
 * plain text; everything else in the document is returned unchanged.
 *
 * F301: throws `MentionVisibilityCheckError` if the underlying visibility
 * lookup fails (a transient DB error) rather than treating an unreadable
 * result as "nothing is visible" — see that class's doc comment. Callers
 * must not persist `doc` unsanitised as a fallback on catch (that would
 * skip AS-376 entirely); the whole write should fail instead.
 */
export async function sanitiseMentionsForVisibility(
  admin: AdminClient,
  doc: JSONContent,
  ctx: { projectId: string; workspaceId: string; projectVisibility: string },
): Promise<JSONContent> {
  const mentionedIds = new Set<string>();
  collectMentionIds(doc, mentionedIds);

  if (mentionedIds.size === 0) return doc;

  const visibleIds = await resolveVisibleMentionIds(
    admin,
    Array.from(mentionedIds),
    ctx,
  );

  const hasInvisibleMention = Array.from(mentionedIds).some(
    (id) => !visibleIds.has(id),
  );
  if (!hasInvisibleMention) return doc;

  return stripInvisibleMentions(doc, visibleIds) as JSONContent;
}
