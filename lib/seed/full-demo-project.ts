// Part B of the "kitchen sink" demo-data seed (see
// scripts/seed-full-demo.ts for the single orchestration entrypoint).
//
// Deviation from lib/seed/sample-project.ts's pattern (recorded here and in
// this feature's handoff, per the "don't silently deviate" rule):
// sample-project.ts's `createSampleProject` is a thin wrapper over the
// app's real "use server" Server Actions (createProject/createTask/
// addChecklistItem/addComment), invoked from a request that already has a
// live Next.js cookies()-backed session. This module is invoked from a
// standalone script (scripts/seed-full-demo.ts) with NO Next.js
// request/render context -- importing any "use server" action file here
// throws immediately (`next/headers`'s `cookies()` requires an active
// request store; there is none outside `next dev`/`next start`). Reusing
// the exact Server Actions as the spec's default preference asked for is
// therefore not technically possible for a script; the closest available
// equivalent already established for this exact class of problem is
// scripts/seed-demo.mjs's own pattern: the privileged admin (secret-key)
// client, which is what every Server Action already reaches for once it
// has independently re-verified membership/permissions itself.
//
// This module still respects every DB-level invariant those actions rely
// on (CHECK constraints, the `create_notification`/`create_workspace_with_
// owner` SECURITY DEFINER RPCs, the doc-folder-scope trigger, the
// project-statuses seed trigger, tasks' default-task-type trigger) --
// nothing here works around a constraint, it just performs the insert
// directly instead of through a cookie-authenticated request.

import { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export type DemoRole =
  | "owner"
  | "admin"
  | "member"
  | "viewer"
  | "guest"
  | "client";

export type CreateFullDemoProjectResult =
  | {
      ok: true;
      data: {
        projectId: string;
        projectName: string;
        tasksCreated: number;
      };
    }
  | { ok: false; error: string };

function isoDateInDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isoTimestampInDays(days: number, hour = 10): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

function messageBody(text: string) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
    ],
  };
}

async function must<T>(
  label: string,
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
): Promise<NonNullable<T>> {
  const { data, error } = await promise;
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
  if (data === null || data === undefined) {
    throw new Error(`${label}: no data returned`);
  }
  return data as NonNullable<T>;
}

export async function createFullDemoProject(
  workspaceId: string,
  memberUserIds: Record<DemoRole, string>,
): Promise<CreateFullDemoProjectResult> {
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, error: "Invalid workspace." };
  }

  const admin: Admin = createAdminClient();
  const owner = memberUserIds.owner;
  const roles: DemoRole[] = [
    "owner",
    "admin",
    "member",
    "viewer",
    "guest",
    "client",
  ];

  try {
    // -----------------------------------------------------------------
    // 1. Project
    // -----------------------------------------------------------------
    const project = await must(
      "insert project",
      admin
        .from("projects")
        .insert({
          workspace_id: workspaceId,
          name: "Goodguys Demo — Website Relaunch",
          description:
            "Kitchen-sink demo project: every feature the app has, populated with realistic data.",
          start_date: isoDateInDays(-14),
          end_date: isoDateInDays(30),
          created_by: owner,
        })
        .select("id, name")
        .single(),
    );
    const projectId = project.id as string;

    // Project members: everyone except viewer/guest/client get an explicit
    // project_members row (lead for owner, member for the rest); viewer/
    // guest/client rely on workspace-level visibility + the client-portal
    // path instead, matching how the rest of the app treats those roles.
    await must(
      "insert project_members",
      admin
        .from("project_members")
        .insert([
          {
            project_id: projectId,
            user_id: owner,
            project_role: "lead",
            added_by: owner,
          },
          {
            project_id: projectId,
            user_id: memberUserIds.admin,
            project_role: "member",
            added_by: owner,
          },
          {
            project_id: projectId,
            user_id: memberUserIds.member,
            project_role: "member",
            added_by: owner,
          },
        ])
        .select("project_id"),
    );

    // -----------------------------------------------------------------
    // 2. Board statuses (extend the auto-seeded default four with two
    //    more, covering all 3 categories + all 4 client_buckets).
    // -----------------------------------------------------------------
    const defaultStatuses = await must(
      "load default statuses",
      admin
        .from("project_statuses")
        .select("id, name, category")
        .eq("project_id", projectId),
    );
    const extraStatuses = await must(
      "insert extra statuses",
      admin
        .from("project_statuses")
        .insert([
          {
            project_id: projectId,
            name: "blocked",
            color: "#ef4444",
            category: "in_progress",
            position: 2500,
            client_bucket: "blocked",
          },
          {
            project_id: projectId,
            name: "client_waiting",
            color: "#a855f7",
            category: "not_started",
            position: 500,
            client_bucket: "waiting",
          },
        ])
        .select("id, name, category"),
    );
    const statusByName = new Map<string, string>();
    for (const s of [...defaultStatuses, ...extraStatuses]) {
      statusByName.set(s.name as string, s.id as string);
    }

    // -----------------------------------------------------------------
    // 3. Task types: reuse the 6 system-seeded rows (create_workspace_
    //    with_owner already inserted them per workspace) rather than
    //    inventing new ones.
    // -----------------------------------------------------------------
    const taskTypes = await must(
      "load task_types",
      admin
        .from("task_types")
        .select("id, system_key")
        .eq("workspace_id", workspaceId),
    );
    const typeByKey = new Map<string, string>();
    for (const t of taskTypes) {
      if (t.system_key) typeByKey.set(t.system_key as string, t.id as string);
    }

    // -----------------------------------------------------------------
    // 4. Tasks: ~18 tasks spread across statuses/priorities/types.
    // -----------------------------------------------------------------
    type TaskSeed = {
      title: string;
      description: string;
      status: string;
      priority: "urgent" | "high" | "medium" | "low" | "backlog" | null;
      typeKey: string | null;
      tags: string[];
      dueInDays: number | null;
      startInDays: number | null;
      estimateMinutes: number | null;
      points: number | null;
      clientVisible: boolean;
      recurrence?: string;
    };

    const TASKS: TaskSeed[] = [
      { title: "Kickoff & discovery brief", description: "Capture goals, audience, and success metrics.", status: "done", priority: "high", typeKey: "delivery", tags: ["planning"], dueInDays: -10, startInDays: -14, estimateMinutes: 240, points: 3, clientVisible: true },
      { title: "Sitemap & IA", description: "Draft the new information architecture.", status: "done", priority: "medium", typeKey: "delivery", tags: ["ux"], dueInDays: -7, startInDays: -10, estimateMinutes: 180, points: 2, clientVisible: true },
      { title: "Homepage wireframes", description: "Low-fidelity wireframes for the homepage.", status: "in_review", priority: "high", typeKey: "delivery", tags: ["ux", "design"], dueInDays: 2, startInDays: -3, estimateMinutes: 300, points: 5, clientVisible: true },
      { title: "Design system tokens", description: "Establish color/type/spacing tokens in Figma.", status: "in_progress", priority: "high", typeKey: "component", tags: ["design", "design-system"], dueInDays: 4, startInDays: -1, estimateMinutes: 360, points: 5, clientVisible: false },
      { title: "Hero section component", description: "Build the reusable hero component.", status: "in_progress", priority: "medium", typeKey: "component", tags: ["dev", "component"], dueInDays: 6, startInDays: 0, estimateMinutes: 240, points: 3, clientVisible: false },
      { title: "Pricing page copy", description: "Write final pricing page copy.", status: "client_waiting", priority: "medium", typeKey: "content", tags: ["copy"], dueInDays: 3, startInDays: 0, estimateMinutes: 120, points: 2, clientVisible: true },
      { title: "SEO audit of current site", description: "Baseline SEO audit before relaunch.", status: "todo", priority: "low", typeKey: "seo", tags: ["seo"], dueInDays: 10, startInDays: 5, estimateMinutes: 180, points: 2, clientVisible: false },
      { title: "Accessibility pass on forms", description: "WCAG AA pass on all form components.", status: "todo", priority: "high", typeKey: "qa", tags: ["a11y", "qa"], dueInDays: 12, startInDays: 6, estimateMinutes: 180, points: 3, clientVisible: false },
      { title: "Fix broken checkout redirect", description: "QA found a broken redirect after checkout.", status: "blocked", priority: "urgent", typeKey: "qa", tags: ["bug"], dueInDays: 1, startInDays: -1, estimateMinutes: 90, points: 1, clientVisible: false },
      { title: "Client request: add FAQ section", description: "Client asked for an FAQ block on pricing.", status: "todo", priority: "medium", typeKey: "client_request", tags: ["client"], dueInDays: 14, startInDays: 7, estimateMinutes: 120, points: 2, clientVisible: true },
      { title: "Change request: swap hero video", description: "Approved change request from the client.", status: "todo", priority: "high", typeKey: "change_request", tags: ["client"], dueInDays: 9, startInDays: 3, estimateMinutes: 150, points: 2, clientVisible: true },
      { title: "Improve build pipeline caching", description: "Internal improvement, not client-billable.", status: "todo", priority: "low", typeKey: "improvement", tags: ["internal"], dueInDays: 20, startInDays: 10, estimateMinutes: 90, points: 1, clientVisible: false },
      { title: "Weekly status email", description: "Recurring weekly status update to the client.", status: "todo", priority: "low", typeKey: "delivery", tags: ["recurring"], dueInDays: 7, startInDays: 7, estimateMinutes: 30, points: null, clientVisible: true, recurrence: "weekly" },
      { title: "Launch checklist", description: "Final pre-launch checklist.", status: "todo", priority: "urgent", typeKey: "delivery", tags: ["launch"], dueInDays: 27, startInDays: 25, estimateMinutes: 60, points: 1, clientVisible: false },
      { title: "Post-launch monitoring setup", description: "Set up uptime + error monitoring.", status: "todo", priority: "medium", typeKey: "delivery", tags: ["ops"], dueInDays: 28, startInDays: 26, estimateMinutes: 120, points: 2, clientVisible: false },
      { title: "Blog template", description: "Build the blog listing + article templates.", status: "in_progress", priority: "backlog", typeKey: "component", tags: ["dev"], dueInDays: 18, startInDays: 8, estimateMinutes: 300, points: 5, clientVisible: false },
      { title: "404 page redesign", description: "Redesign and rebuild the 404 page.", status: "done", priority: "backlog", typeKey: "component", tags: ["dev"], dueInDays: -2, startInDays: -5, estimateMinutes: 60, points: 1, clientVisible: false },
      { title: "Analytics events plan", description: "Document the analytics event taxonomy.", status: "in_review", priority: null, typeKey: "delivery", tags: ["analytics"], dueInDays: 5, startInDays: 1, estimateMinutes: 120, points: 2, clientVisible: false },
    ];

    let tasksCreated = 0;
    const createdTaskIds: string[] = [];
    const taskIdByTitle = new Map<string, string>();

    for (const t of TASKS) {
      const statusId = statusByName.get(t.status) ?? null;
      const row = await must(
        `insert task "${t.title}"`,
        admin
          .from("tasks")
          .insert({
            project_id: projectId,
            title: t.title,
            description: t.description,
            status: statusByName.has(t.status) ? t.status : "todo",
            status_id: statusId,
            priority: t.priority,
            tags: t.tags,
            author_id: owner,
            due_date: t.dueInDays !== null ? isoDateInDays(t.dueInDays) : null,
            start_date:
              t.startInDays !== null ? isoDateInDays(t.startInDays) : null,
            estimate_minutes: t.estimateMinutes,
            points: t.points,
            task_type_id: (t.typeKey ? typeByKey.get(t.typeKey) : undefined) ?? typeByKey.get("delivery")!,
            client_visible: t.clientVisible,
            recurrence:
              t.recurrence === "weekly"
                ? { freq: "weekly", interval: 1 }
                : null,
          })
          .select("id")
          .single(),
      );
      tasksCreated += 1;
      createdTaskIds.push(row.id as string);
      taskIdByTitle.set(t.title, row.id as string);
    }

    // Subtasks under "Homepage wireframes".
    const wireframesId = taskIdByTitle.get("Homepage wireframes")!;
    const subtaskRows = await must(
      "insert subtasks",
      admin
        .from("tasks")
        .insert([
          {
            project_id: projectId,
            parent_task_id: wireframesId,
            title: "Wireframe: hero + nav",
            status: "done",
            status_id: statusByName.get("done") ?? null,
            priority: "medium",
            author_id: owner,
            task_type_id: typeByKey.get("delivery")!,
          },
          {
            project_id: projectId,
            parent_task_id: wireframesId,
            title: "Wireframe: pricing + footer",
            status: "in_review",
            status_id: statusByName.get("in_review") ?? null,
            priority: "medium",
            author_id: owner,
            task_type_id: typeByKey.get("delivery")!,
          },
        ])
        .select("id"),
    );
    tasksCreated += subtaskRows.length;

    // Blocked task with blocked_reason.
    const checkoutBugId = taskIdByTitle.get("Fix broken checkout redirect")!;
    await must(
      "set blocked_reason",
      admin
        .from("tasks")
        .update({
          blocked_reason:
            "Waiting on staging credentials from the client to reproduce.",
        })
        .eq("id", checkoutBugId)
        .select("id")
        .single(),
    );

    // Mixed single/multi assignees.
    const assigneeSeeds: Array<{ title: string; roles: DemoRole[] }> = [
      { title: "Homepage wireframes", roles: ["member"] },
      { title: "Design system tokens", roles: ["admin", "member"] },
      { title: "Hero section component", roles: ["member"] },
      { title: "Pricing page copy", roles: ["admin"] },
      { title: "Fix broken checkout redirect", roles: ["member", "admin"] },
      { title: "Blog template", roles: ["member"] },
    ];
    const assigneeInserts = assigneeSeeds.flatMap(({ title, roles: rs }) =>
      rs.map((r) => ({
        task_id: taskIdByTitle.get(title)!,
        user_id: memberUserIds[r],
        assigned_by: owner,
      })),
    );
    await must(
      "insert task_assignees",
      admin.from("task_assignees").insert(assigneeInserts).select("task_id"),
    );
    // Keep the legacy mirror column populated for the first assignee of
    // each seeded task (task_assignees is the source of truth going
    // forward, per its own migration comment; tasks.assignee_id is kept in
    // sync the same way setTaskAssigneesCore does for a real write).
    for (const { title, roles: rs } of assigneeSeeds) {
      await admin
        .from("tasks")
        .update({ assignee_id: memberUserIds[rs[0]] })
        .eq("id", taskIdByTitle.get(title)!);
    }

    // Checklist items on a couple of tasks.
    await must(
      "insert checklist_items",
      admin
        .from("checklist_items")
        .insert([
          {
            task_id: wireframesId,
            content: "Get stakeholder sign-off on layout",
            is_checked: false,
            position: 1000,
          },
          {
            task_id: wireframesId,
            content: "Export annotated frames for dev",
            is_checked: true,
            checked_by: memberUserIds.member,
            checked_at: new Date().toISOString(),
            position: 2000,
          },
          {
            task_id: taskIdByTitle.get("Design system tokens")!,
            content: "Confirm brand colors with the client",
            is_checked: false,
            position: 1000,
          },
        ])
        .select("task_id"),
    );

    // Dependencies, including one that blocks the blocked task.
    await must(
      "insert task_dependencies",
      admin
        .from("task_dependencies")
        .insert([
          {
            blocking_task_id: taskIdByTitle.get("Sitemap & IA")!,
            blocked_task_id: wireframesId,
            created_by: owner,
          },
          {
            blocking_task_id: wireframesId,
            blocked_task_id: taskIdByTitle.get("Hero section component")!,
            created_by: owner,
          },
          {
            blocking_task_id: taskIdByTitle.get("SEO audit of current site")!,
            blocked_task_id: checkoutBugId,
            created_by: owner,
          },
        ])
        .select("id"),
    );

    // Watchers.
    await must(
      "insert task_watchers",
      admin
        .from("task_watchers")
        .insert([
          { task_id: wireframesId, user_id: memberUserIds.viewer },
          {
            task_id: taskIdByTitle.get("Design system tokens")!,
            user_id: memberUserIds.client,
          },
        ])
        .select("task_id"),
    );

    // Comments: mix internal / client-visible, with one reaction.
    const commentRows = await must(
      "insert comments",
      admin
        .from("comments")
        .insert([
          {
            task_id: wireframesId,
            user_id: memberUserIds.member,
            text: "First pass is up for review — see the Figma link in the description.",
            internal: false,
          },
          {
            task_id: wireframesId,
            user_id: memberUserIds.admin,
            text: "Nice work. Let's tighten the hero spacing before sending to the client.",
            internal: true,
          },
          {
            task_id: taskIdByTitle.get("Fix broken checkout redirect")!,
            user_id: memberUserIds.owner,
            text: "Blocked on staging creds — pinged the client for access.",
            internal: true,
          },
        ])
        .select("id, task_id"),
    );
    await must(
      "insert comment_reactions",
      admin
        .from("comment_reactions")
        .insert({
          comment_id: commentRows[0].id as string,
          task_id: commentRows[0].task_id as string,
          user_id: memberUserIds.admin,
          emoji: "👍",
        })
        .select("comment_id"),
    );

    // Attachments (placeholder URLs).
    await must(
      "insert attachments",
      admin
        .from("attachments")
        .insert([
          {
            task_id: wireframesId,
            file_url: `${wireframesId}/homepage-wireframe-v1.png`,
            file_name: "homepage-wireframe-v1.png",
            uploaded_by: memberUserIds.member,
          },
          {
            task_id: taskIdByTitle.get("Design system tokens")!,
            file_url: `${taskIdByTitle.get("Design system tokens")}/tokens.json`,
            file_name: "tokens.json",
            uploaded_by: memberUserIds.admin,
          },
          {
            task_id: taskIdByTitle.get("Pricing page copy")!,
            file_url: `${taskIdByTitle.get("Pricing page copy")}/pricing-copy-draft.docx`,
            file_name: "pricing-copy-draft.docx",
            uploaded_by: memberUserIds.client,
          },
        ])
        .select("task_id"),
    );

    // Time entries + one active timer.
    await must(
      "insert time_entries",
      admin
        .from("time_entries")
        .insert([
          {
            task_id: wireframesId,
            user_id: memberUserIds.member,
            minutes: 180,
            billable: true,
            note: "Wireframing session",
            entry_date: isoDateInDays(-2),
          },
          {
            task_id: taskIdByTitle.get("Design system tokens")!,
            user_id: memberUserIds.admin,
            minutes: 90,
            billable: true,
            note: "Token audit",
            entry_date: isoDateInDays(-1),
          },
        ])
        .select("task_id"),
    );
    await must(
      "insert active_timers",
      admin
        .from("active_timers")
        .insert({
          task_id: taskIdByTitle.get("Hero section component")!,
          user_id: memberUserIds.member,
        })
        .select("task_id")
        .single(),
    );

    // -----------------------------------------------------------------
    // 5. Calendar blocks + time off.
    // -----------------------------------------------------------------
    await must(
      "insert calendar_blocks",
      admin
        .from("calendar_blocks")
        .insert([
          {
            workspace_id: workspaceId,
            project_id: projectId,
            user_id: memberUserIds.owner,
            title: "Client presentation — homepage review",
            starts_at: isoTimestampInDays(3, 14),
            ends_at: isoTimestampInDays(3, 15),
            block_type: "client_presentation",
            color: "#a855f7",
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            user_id: memberUserIds.member,
            task_id: wireframesId,
            title: "Focus block — wireframes",
            starts_at: isoTimestampInDays(1, 9),
            ends_at: isoTimestampInDays(1, 11),
            block_type: "general",
          },
        ])
        .select("id"),
    );
    await must(
      "insert time_off_entries",
      admin
        .from("time_off_entries")
        .insert({
          workspace_id: workspaceId,
          user_id: memberUserIds.member,
          start_date: isoDateInDays(21),
          end_date: isoDateInDays(25),
          note: "Vacation",
        })
        .select("id")
        .single(),
    );

    // -----------------------------------------------------------------
    // 6. Docs: nested folders + markdown docs.
    // -----------------------------------------------------------------
    const parentFolder = await must(
      "insert doc_folders parent",
      admin
        .from("doc_folders")
        .insert({
          workspace_id: workspaceId,
          project_id: projectId,
          name: "Project Docs",
          created_by: owner,
        })
        .select("id")
        .single(),
    );
    const childFolder = await must(
      "insert doc_folders child",
      admin
        .from("doc_folders")
        .insert({
          workspace_id: workspaceId,
          project_id: projectId,
          parent_id: parentFolder.id,
          name: "Meeting Notes",
          created_by: owner,
        })
        .select("id")
        .single(),
    );

    await must(
      "insert docs",
      admin
        .from("docs")
        .insert([
          {
            workspace_id: workspaceId,
            project_id: projectId,
            folder_id: parentFolder.id,
            title: "Project Brief",
            content:
              "# Project Brief\n\n## Goals\n\n- Relaunch the marketing site\n- Improve conversion on pricing\n\n## Scope\n\n1. New IA\n2. New design system\n3. New CMS templates\n\n```ts\n// example: analytics event shape\ntype PageViewEvent = { path: string; ts: number };\n```",
            created_by: owner,
            updated_by: owner,
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            folder_id: parentFolder.id,
            title: "Brand Guidelines",
            content:
              "# Brand Guidelines\n\n## Colors\n\n- Primary: #3670e1\n- Accent: #a855f7\n\n## Typography\n\n- Headings: Inter, 590 weight\n- Body: Inter, 400 weight",
            created_by: memberUserIds.admin,
            updated_by: memberUserIds.admin,
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            folder_id: childFolder.id,
            title: "Kickoff Call Notes",
            content:
              "# Kickoff Call — Notes\n\n## Attendees\n\n- Owner, Client\n\n## Action items\n\n- [ ] Share brand assets\n- [ ] Confirm launch date",
            created_by: owner,
            updated_by: owner,
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            folder_id: childFolder.id,
            title: "Weekly Sync — Week 2",
            content:
              "# Weekly Sync — Week 2\n\n## Progress\n\n- Wireframes in review\n\n## Blockers\n\n- Waiting on copy from client",
            created_by: memberUserIds.member,
            updated_by: memberUserIds.member,
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            folder_id: null,
            title: "How We Work",
            content:
              "# How We Work\n\n## Process\n\n1. Discover\n2. Design\n3. Build\n4. Launch\n\n## Tools\n\n- Figma\n- This app",
            created_by: owner,
            updated_by: owner,
          },
        ])
        .select("id"),
    );

    // -----------------------------------------------------------------
    // 7. Chat: 2 channels + 1 DM, several messages, one reaction.
    // -----------------------------------------------------------------
    const generalChannel = await must(
      "insert channel general",
      admin
        .from("channels")
        .insert({
          workspace_id: workspaceId,
          kind: "channel",
          name: "general",
          created_by: owner,
        })
        .select("id")
        .single(),
    );
    const projectChannel = await must(
      "insert channel project",
      admin
        .from("channels")
        .insert({
          workspace_id: workspaceId,
          project_id: projectId,
          kind: "channel",
          name: "website-relaunch",
          created_by: owner,
        })
        .select("id")
        .single(),
    );
    const dmUserLow =
      memberUserIds.owner < memberUserIds.admin
        ? memberUserIds.owner
        : memberUserIds.admin;
    const dmUserHigh =
      memberUserIds.owner < memberUserIds.admin
        ? memberUserIds.admin
        : memberUserIds.owner;
    const dmChannel = await must(
      "insert channel dm",
      admin
        .from("channels")
        .insert({
          workspace_id: workspaceId,
          kind: "dm",
          created_by: owner,
          dm_user_low: dmUserLow,
          dm_user_high: dmUserHigh,
        })
        .select("id")
        .single(),
    );

    await must(
      "insert channel_members general",
      admin
        .from("channel_members")
        .insert(
          roles
            .filter((r) => r !== "client" && r !== "guest")
            .map((r) => ({
              channel_id: generalChannel.id,
              user_id: memberUserIds[r],
            })),
        )
        .select("channel_id"),
    );
    await must(
      "insert channel_members project",
      admin
        .from("channel_members")
        .insert(
          (["owner", "admin", "member"] as DemoRole[]).map((r) => ({
            channel_id: projectChannel.id,
            user_id: memberUserIds[r],
          })),
        )
        .select("channel_id"),
    );
    await must(
      "insert channel_members dm",
      admin
        .from("channel_members")
        .insert([
          { channel_id: dmChannel.id, user_id: memberUserIds.owner },
          { channel_id: dmChannel.id, user_id: memberUserIds.admin },
        ])
        .select("channel_id"),
    );

    const messageRows = await must(
      "insert messages",
      admin
        .from("messages")
        .insert([
          {
            channel_id: generalChannel.id,
            sender_id: memberUserIds.owner,
            body_json: messageBody("Welcome to Goodguys Demo 👋"),
          },
          {
            channel_id: generalChannel.id,
            sender_id: memberUserIds.member,
            body_json: messageBody("Excited to get started!"),
          },
          {
            channel_id: projectChannel.id,
            sender_id: memberUserIds.admin,
            body_json: messageBody(
              "Homepage wireframes are up for review — link in the task.",
            ),
          },
          {
            channel_id: projectChannel.id,
            sender_id: memberUserIds.member,
            body_json: messageBody("On it, reviewing now."),
          },
          {
            channel_id: dmChannel.id,
            sender_id: memberUserIds.owner,
            body_json: messageBody(
              "Can you take a look at the budget numbers before Friday?",
            ),
          },
          {
            channel_id: dmChannel.id,
            sender_id: memberUserIds.admin,
            body_json: messageBody("Yep, will do this afternoon."),
          },
        ])
        .select("id"),
    );
    await must(
      "insert message_reactions",
      admin
        .from("message_reactions")
        .insert({
          message_id: messageRows[0].id as string,
          channel_id: generalChannel.id as string,
          user_id: memberUserIds.member,
          emoji: "🎉",
        })
        .select("message_id"),
    );

    // -----------------------------------------------------------------
    // 8. Portal data: phases, deliverables, scope, decisions,
    //    assumptions, client request, approval request, budgets.
    // -----------------------------------------------------------------
    const phaseRows = await must(
      "insert project_phases",
      admin
        .from("project_phases")
        .insert([
          {
            project_id: projectId,
            name: "Discovery",
            client_description: "Understanding goals and requirements.",
            position: 1,
            state: "done",
            planned_start: isoDateInDays(-14),
            planned_end: isoDateInDays(-7),
            actual_start: isoDateInDays(-14),
            actual_end: isoDateInDays(-8),
          },
          {
            project_id: projectId,
            name: "Design",
            client_description: "Wireframes, visual design, and design system.",
            position: 2,
            state: "active",
            planned_start: isoDateInDays(-7),
            planned_end: isoDateInDays(7),
            actual_start: isoDateInDays(-7),
          },
          {
            project_id: projectId,
            name: "Build",
            client_description: "Front-end build and CMS integration.",
            position: 3,
            state: "not_started",
            planned_start: isoDateInDays(8),
            planned_end: isoDateInDays(24),
          },
          {
            project_id: projectId,
            name: "Launch",
            client_description: "QA, launch, and post-launch monitoring.",
            position: 4,
            state: "not_started",
            planned_start: isoDateInDays(25),
            planned_end: isoDateInDays(30),
          },
        ])
        .select("id, name"),
    );
    const phaseByName = new Map<string, string>();
    for (const p of phaseRows) phaseByName.set(p.name as string, p.id as string);

    await must(
      "insert client_deliverables",
      admin
        .from("client_deliverables")
        .insert([
          {
            project_id: projectId,
            phase_id: phaseByName.get("Design")!,
            task_id: wireframesId,
            title: "Homepage design",
            description: "Final homepage design for approval.",
            kind: "image",
            owner_name: "Design team",
            due_at: isoDateInDays(2),
            blocking: true,
            state: "in_progress",
          },
          {
            project_id: projectId,
            phase_id: phaseByName.get("Discovery")!,
            title: "Brand assets",
            description: "Logo files and brand guidelines from the client.",
            kind: "access",
            owner_name: "Client",
            due_at: isoDateInDays(-5),
            blocking: false,
            state: "accepted",
            delivered_at: isoTimestampInDays(-6),
            accepted_at: isoTimestampInDays(-5),
            accepted_by: owner,
          },
          {
            project_id: projectId,
            phase_id: phaseByName.get("Design")!,
            title: "Pricing page copy",
            kind: "copy",
            owner_name: "Client",
            due_at: isoDateInDays(3),
            blocking: true,
            state: "not_started",
          },
        ])
        .select("id"),
    );

    await must(
      "insert project_scope_items",
      admin
        .from("project_scope_items")
        .insert([
          {
            project_id: projectId,
            title: "Up to 8 marketing pages",
            included: true,
            source: "proposal",
            position: 1,
          },
          {
            project_id: projectId,
            title: "Blog with CMS-managed articles",
            included: true,
            source: "proposal",
            position: 2,
          },
          {
            project_id: projectId,
            title: "Custom e-commerce checkout",
            description: "Explicitly excluded from this phase of work.",
            included: false,
            source: "proposal",
            position: 3,
          },
        ])
        .select("id"),
    );

    await must(
      "insert project_decisions",
      admin
        .from("project_decisions")
        .insert([
          {
            project_id: projectId,
            phase_id: phaseByName.get("Design")!,
            title: "Use Inter as the primary typeface",
            rationale: "Matches the brand refresh and is well supported.",
            decision_type: "brand",
            decided_on: isoDateInDays(-3),
            decided_by_name: "Design lead",
            client_visible: true,
            created_by: memberUserIds.admin,
          },
          {
            project_id: projectId,
            title: "Adopt Next.js App Router for the rebuild",
            rationale:
              "Internal technical decision — not relevant to the client's day-to-day.",
            decision_type: "technical",
            decided_on: isoDateInDays(-9),
            decided_by_name: "Tech lead",
            client_visible: false,
            created_by: owner,
          },
        ])
        .select("id"),
    );

    await must(
      "insert project_assumptions",
      admin
        .from("project_assumptions")
        .insert({
          project_id: projectId,
          text: "Client will provide final copy for all pages by the Design phase deadline.",
          state: "assumed",
          client_visible: true,
        })
        .select("id")
        .single(),
    );

    await must(
      "insert client_requests",
      admin
        .from("client_requests")
        .insert({
          project_id: projectId,
          created_by: memberUserIds.client,
          title: "Add a live chat widget to the homepage",
          body: "Can we add a live chat widget so visitors can ask questions directly?",
          desired_by: isoDateInDays(15),
          status: "submitted",
        })
        .select("id")
        .single(),
    );

    await must(
      "insert approval_requests",
      admin
        .from("approval_requests")
        .insert({
          project_id: projectId,
          phase_id: phaseByName.get("Design")!,
          subject_type: "task",
          subject_id: wireframesId,
          title: "Approve homepage wireframes",
          description: "Please review and approve before we move to visual design.",
          decision_type: "content",
          state: "pending",
          requested_by: memberUserIds.admin,
          due_at: isoTimestampInDays(4),
        })
        .select("id")
        .single(),
    );

    await must(
      "insert project_budgets",
      admin
        .from("project_budgets")
        .insert({
          project_id: projectId,
          period_start: isoDateInDays(-14),
          period_end: isoDateInDays(16),
          sold_minutes: 60 * 40,
          currency: "USD",
          rate_amount: 150,
          rollover: "next_period",
          note: "Initial 40-hour retainer block.",
        })
        .select("id")
        .single(),
    );

    // -----------------------------------------------------------------
    // 9. Custom fields + values.
    // -----------------------------------------------------------------
    const customFields = await must(
      "insert project_custom_fields",
      admin
        .from("project_custom_fields")
        .insert([
          {
            project_id: projectId,
            name: "Client reference number",
            field_type: "text",
            position: 1000,
          },
          {
            project_id: projectId,
            name: "Figma frame link",
            field_type: "url",
            position: 2000,
          },
        ])
        .select("id, name"),
    );
    const fieldByName = new Map<string, string>();
    for (const f of customFields) fieldByName.set(f.name as string, f.id as string);

    await must(
      "insert task_custom_field_values",
      admin
        .from("task_custom_field_values")
        .insert([
          {
            task_id: wireframesId,
            field_id: fieldByName.get("Client reference number")!,
            value: "REF-1042",
          },
          {
            task_id: wireframesId,
            field_id: fieldByName.get("Figma frame link")!,
            value: "https://figma.com/file/demo-homepage",
          },
        ])
        .select("task_id"),
    );

    // -----------------------------------------------------------------
    // 10. Task template.
    // -----------------------------------------------------------------
    await must(
      "insert task_templates",
      admin
        .from("task_templates")
        .insert({
          workspace_id: workspaceId,
          kind: "task",
          name: "Standard QA pass",
          payload: {
            title: "QA pass",
            description: "Run the standard QA checklist before sign-off.",
            priority: "medium",
            checklistItems: [
              "Cross-browser check",
              "Mobile responsive check",
              "Accessibility check",
            ],
            estimate_minutes: 120,
            tags: ["qa"],
          },
          created_by: owner,
        })
        .select("id")
        .single(),
    );

    // -----------------------------------------------------------------
    // 11. Saved views: one each of board/list/calendar/timeline.
    // -----------------------------------------------------------------
    await must(
      "insert saved_views",
      admin
        .from("saved_views")
        .insert([
          {
            workspace_id: workspaceId,
            project_id: projectId,
            owner_id: owner,
            name: "Board — by status",
            scope: "shared",
            view_type: "board",
            config: { groupBy: "status" },
            is_default: true,
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            owner_id: memberUserIds.admin,
            name: "My open tasks",
            scope: "personal",
            view_type: "list",
            config: { filters: { assignee: "me", status: ["todo", "in_progress"] } },
            is_default: false,
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            owner_id: owner,
            name: "Launch calendar",
            scope: "shared",
            view_type: "calendar",
            config: {},
            is_default: false,
          },
          {
            workspace_id: workspaceId,
            project_id: projectId,
            owner_id: owner,
            name: "Project timeline",
            scope: "shared",
            view_type: "timeline",
            config: {},
            is_default: false,
          },
        ])
        .select("id"),
    );

    // -----------------------------------------------------------------
    // 12. Notifications across kinds/users, via create_notification RPC
    //     (the only INSERT path -- see notifications' own migration).
    // -----------------------------------------------------------------
    const notificationSeeds: Array<{
      user: DemoRole;
      kind: string;
      actor: DemoRole;
      taskId?: string;
      commentId?: string;
    }> = [
      { user: "member", kind: "task_assigned", actor: "owner", taskId: wireframesId },
      { user: "admin", kind: "mention", actor: "member", taskId: wireframesId, commentId: commentRows[0].id as string },
      { user: "owner", kind: "comment_reply", actor: "admin", taskId: wireframesId, commentId: commentRows[1].id as string },
      { user: "member", kind: "task_due_soon", actor: "owner", taskId: checkoutBugId },
      { user: "viewer", kind: "watcher_update", actor: "member", taskId: wireframesId },
    ];
    for (const n of notificationSeeds) {
      const { error } = await admin.rpc("create_notification", {
        p_user_id: memberUserIds[n.user],
        p_workspace_id: workspaceId,
        p_kind: n.kind,
        p_actor_id: memberUserIds[n.actor],
        p_task_id: n.taskId ?? undefined,
        p_comment_id: n.commentId ?? undefined,
        p_payload: {},
      });
      if (error) {
        throw new Error(`create_notification(${n.kind}) failed: ${error.message}`);
      }
    }

    return {
      ok: true,
      data: {
        projectId,
        projectName: project.name as string,
        tasksCreated,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown seed error.",
    };
  }
}
