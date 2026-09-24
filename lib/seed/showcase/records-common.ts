// Records every showcase project gets: task attachments (real files),
// docs, the project chat channel conversation, saved views, board prefs.

import type { People, PersonKey } from "./accounts";
import type { ProjectCtx } from "./build-project";
import { PROJECT_CHAT, type ChatMessage } from "./content-chat";
import { PROJECT_DOCS, type DocFolderSpec } from "./content-docs";
import { fileContent, mimeOf, storageSafeName, uniquePrefix, upload } from "./storage";
import { type Admin, at, insertRows, richDoc, uuid } from "./util";

export async function seedCommon(
  ctx: ProjectCtx,
  opts: { briefDocId: string | null; flaggedAssumptionId?: string },
) {
  const { admin, projectId, people: p, spec, taskIds, counts, workspaceId } = ctx;

  // ------------------------------------------------------ attachments
  const attachmentRows = [];
  for (const [i, a] of spec.attachments.entries()) {
    const path = `${taskIds[a.task]}/${uniquePrefix()}-${storageSafeName(a.name)}`;
    await upload(admin, "task-attachments", path, fileContent(a.kind, a.name, a.accent, i), mimeOf(a.kind));
    attachmentRows.push({ task_id: taskIds[a.task], file_url: path, file_name: a.name, mime_type: mimeOf(a.kind), uploaded_by: p[a.by], created_at: at(-a.daysAgo, 14, i) });
  }
  await insertRows(admin, "attachments", attachmentRows, counts);
  counts.storage_objects = (counts.storage_objects ?? 0) + attachmentRows.length;

  // ------------------------------------------------------------- docs
  const docs = PROJECT_DOCS[spec.key];
  const docIds = await seedDocs(admin, workspaceId, projectId, p, docs, counts, opts.briefDocId);
  if (opts.briefDocId) {
    const briefId = (ctx as ProjectCtx & { briefId?: string }).briefId;
    if (briefId) {
      const { error } = await admin.from("briefs").update({ doc_id: opts.briefDocId }).eq("id", briefId);
      if (error) throw new Error(`link brief doc: ${error.message}`);
    }
  }
  (ctx as ProjectCtx & { docIds?: Record<string, string> }).docIds = docIds;

  // ----------------------------------------------------- project chat
  await seedChannelMessages(admin, ctx.channelId, p, PROJECT_CHAT[spec.key], counts);

  // --------------------------------------------------- saved views
  // The four default tabs createProject adds, with hand-picked tasks in
  // them (view_tasks), plus a few filtered views.
  const viewIds = { Setup: uuid(), Design: uuid(), Dev: uuid(), QA: uuid() };
  const lead = p[spec.lead];
  const statusNames = (names: string[]) => names;
  await insertRows(admin, "saved_views", [
    ...Object.entries(viewIds).map(([name, id], i) => ({
      id, workspace_id: workspaceId, project_id: projectId, owner_id: lead, name, scope: "shared", view_type: "list",
      config: { filters: [], sort: [], groupBy: null }, is_default: false, position: (i + 1) * 1000,
    })),
    {
      workspace_id: workspaceId, project_id: projectId, owner_id: lead, name: "Urgent & high", scope: "shared", view_type: "list",
      config: { filters: [{ field: "priority", operator: "in", value: ["urgent", "high"] }], sort: [{ field: "dueDate", direction: "asc" }], groupBy: null },
      position: 5000,
    },
    {
      workspace_id: workspaceId, project_id: projectId, owner_id: lead, name: "Waiting on Nordvik", scope: "shared", view_type: "list",
      config: { filters: [{ field: "status", operator: "in", value: statusNames(["Awaiting Client", "Blocked"]) }], sort: [{ field: "dueDate", direction: "asc" }], groupBy: null },
      position: 6000,
    },
    {
      workspace_id: workspaceId, project_id: projectId, owner_id: p.john, name: "My open work", scope: "personal", view_type: "list",
      config: {
        filters: [],
        filterGroup: { combinator: "and", conditions: [
          { field: "assigneeId", operator: "eq", value: p.john },
          { field: "status", operator: "in", value: ["To Do", "In Dev", "QA by Dev", "Blocked"] },
        ] },
        sort: [{ field: "dueDate", direction: "asc" }],
        groupBy: null,
      },
      position: 7000,
    },
    {
      workspace_id: workspaceId, project_id: projectId, owner_id: lead, name: "Board", scope: "personal", view_type: "board",
      config: { filters: [], sort: [], groupBy: null }, is_default: true, position: 8000,
    },
  ], counts);

  const bucket = (view: keyof typeof viewIds, refs: string[]) =>
    refs.filter((r) => taskIds[r]).map((r, i) => ({ view_id: viewIds[view], task_id: taskIds[r], position: (i + 1) * 1000, added_by: lead }));
  const refsByType = (pred: (ref: string) => boolean) => Object.keys(taskIds).filter((r) => !r.includes("#") && pred(r));
  const specOf = (r: string) => ctx.taskSpecs[r];
  await insertRows(admin, "view_tasks", [
    ...bucket("Setup", refsByType((r) => ["Discovery", "Q2 — CRO sprint"].includes(specOf(r)?.phase ?? "") || /setup|kickoff|audit/.test(r))),
    ...bucket("Design", refsByType((r) => (specOf(r)?.assignees ?? []).includes("maja"))),
    ...bucket("Dev", refsByType((r) => (specOf(r)?.assignees ?? []).some((a) => a === "marko" || a === "john") && specOf(r)?.type !== "qa")),
    ...bucket("QA", refsByType((r) => specOf(r)?.type === "qa" || (specOf(r)?.assignees ?? []).includes("nina"))),
  ], counts);

  // Board swimlanes: the lead groups by assignee, John by priority.
  await insertRows(admin, "board_swimlane_prefs", [
    { user_id: lead, project_id: projectId, group_by: "assignee", collapsed_lanes: { assignee: ["__none__"] } },
    { user_id: p.john, project_id: projectId, group_by: "priority", collapsed_lanes: { priority: ["low", "backlog", "__none__"] } },
  ], counts);
}

// --------------------------------------------------------------- docs

export async function seedDocs(
  admin: Admin,
  workspaceId: string,
  projectId: string | null,
  p: People,
  folders: DocFolderSpec[],
  counts: Record<string, number>,
  briefDocId: string | null = null,
): Promise<Record<string, string>> {
  const folderRows: Array<Record<string, unknown>> = [];
  const docRows: Array<Record<string, unknown>> = [];
  const linkRows: Array<Record<string, unknown>> = [];
  const ids: Record<string, string> = {};

  const walk = (list: DocFolderSpec[], parentId: string | null) => {
    list.forEach((f, fi) => {
      const folderId = f.name ? uuid() : null;
      if (folderId) {
        folderRows.push({ id: folderId, workspace_id: workspaceId, project_id: projectId, parent_id: parentId, name: f.name, position: (fi + 1) * 1000, created_by: p[f.by ?? "tom"] });
      }
      f.docs.forEach((d, di) => {
        const id = d.kind === "brief" && briefDocId ? briefDocId : uuid();
        ids[d.title] = id;
        docRows.push({
          id,
          workspace_id: workspaceId,
          project_id: projectId,
          folder_id: folderId ?? parentId,
          title: d.title,
          content: d.content.trim(),
          position: (di + 1) * 1000,
          created_by: p[d.by],
          updated_by: p[d.updatedBy ?? d.by],
          created_at: at(-d.daysAgo, 10, di),
          updated_at: at(-(d.updatedDaysAgo ?? d.daysAgo), 15, di),
          client_visible: d.clientVisible ?? false,
          doc_kind: d.kind ?? "note",
          relevant_from: d.relevantFrom ?? null,
        });
        (d.links ?? []).forEach((l, li) => linkRows.push({ doc_id: id, url: l.url, title: l.title, description: l.description ?? null, position: li }));
      });
      if (f.children) walk(f.children, folderId);
    });
  };
  walk(folders, null);

  // Parents before children (doc_folders scope trigger checks the parent).
  const roots = folderRows.filter((f) => f.parent_id === null);
  const nested = folderRows.filter((f) => f.parent_id !== null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await insertRows(admin, "doc_folders", roots as any, counts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await insertRows(admin, "doc_folders", nested as any, counts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await insertRows(admin, "docs", docRows as any, counts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await insertRows(admin, "doc_links", linkRows as any, counts);
  return ids;
}

// --------------------------------------------------------------- chat

export async function seedChannelMessages(
  admin: Admin,
  channelId: string,
  p: People,
  messages: ChatMessage[],
  counts: Record<string, number>,
) {
  const rows: Array<Record<string, unknown>> = [];
  const reactions: Array<Record<string, unknown>> = [];
  const files: Array<Record<string, unknown>> = [];
  let latest = "";

  const add = (m: ChatMessage, parentId: string | null) => {
    const id = uuid();
    const doc = richDoc([typeof m.parts === "function" ? m.parts(p) : m.parts]);
    const created = at(-m.daysAgo, m.hour ?? 10, m.minute ?? 0);
    if (created > latest) latest = created;
    rows.push({ id, channel_id: channelId, sender_id: p[m.by], body_json: doc.json, body_text: doc.text, parent_message_id: parentId, created_at: created, edited_at: m.edited ? at(-m.daysAgo, (m.hour ?? 10) + 0, (m.minute ?? 0) + 3) : null });
    for (const [who, emoji] of m.reactions ?? []) reactions.push({ message_id: id, channel_id: channelId, user_id: p[who], emoji, created_at: created });
    if (m.file) files.push({ id: uuid(), channel_id: channelId, message_id: id, file: m.file, uploaded_by: p[m.by], created_at: created });
    for (const r of m.replies ?? []) add(r, id);
  };
  messages.forEach((m) => add(m, null));

  const parents = rows.filter((r) => r.parent_message_id === null);
  const replies = rows.filter((r) => r.parent_message_id !== null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await insertRows(admin, "messages", parents as any, counts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await insertRows(admin, "messages", replies as any, counts);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await insertRows(admin, "message_reactions", reactions as any, counts);

  const attachmentRows = [];
  for (const [i, f] of files.entries()) {
    const file = f.file as NonNullable<ChatMessage["file"]>;
    const path = `${channelId}/${uniquePrefix()}-${storageSafeName(file.name)}`;
    const body = fileContent(file.kind, file.name, file.accent, i);
    await upload(admin, "chat-attachments", path, body, mimeOf(file.kind));
    attachmentRows.push({ channel_id: channelId, message_id: f.message_id, storage_path: path, file_name: file.name, mime_type: mimeOf(file.kind), file_size: body.length, uploaded_by: f.uploaded_by, created_at: f.created_at });
  }
  await insertRows(admin, "message_attachments", attachmentRows, counts);
  counts.storage_objects = (counts.storage_objects ?? 0) + attachmentRows.length;

  // Everyone has read up to ~2 days ago; a few people are fully caught up.
  const { data: members } = await admin.from("channel_members").select("user_id").eq("channel_id", channelId);
  const caughtUp = new Set([p.tom, p.anna]);
  for (const m of members ?? []) {
    const lastRead = caughtUp.has(m.user_id) ? latest : at(-2, 18);
    await admin.from("channel_members").update({ last_read_at: lastRead }).eq("channel_id", channelId).eq("user_id", m.user_id);
  }
}

export type { PersonKey };
