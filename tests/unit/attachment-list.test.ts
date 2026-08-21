// Unit test for F066 (AS-109, AS-115).
//
// Renders AttachmentList (components/task/attachment-list.tsx) directly,
// the same component task-detail-sheet.tsx (F039) composes, mirroring
// tests/unit/comment-list.test.ts's renderToStaticMarkup convention (no
// jsdom/RTL in this repo's vitest setup — see vitest.config.ts's `node`
// environment).
//
//   AS-109: a task shows a list of its attachments with file name and
//     uploader.
//   AS-115: the attachment list updates immediately in the UI after a
//     successful upload, without requiring a page reload. Since this
//     repo's vitest environment is "node" (no DOM, no file input
//     simulation), this is asserted at the level this component actually
//     delegates to: the pure `appendAttachment` reducer
//     (lib/tasks/append-attachment.ts) that the component's upload
//     success handler calls to produce the next local-state list — the
//     same "extract a pure reducer for a DOM-free unit test" convention
//     used by lib/tasks/reconcile-realtime-comment.ts for F062/F063's
//     realtime-append behaviour.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  AttachmentList,
  type TaskAttachment,
  type AttachmentListMember,
} from "@/components/task/attachment-list";
import { appendAttachment } from "@/lib/tasks/append-attachment";

const MEMBERS: AttachmentListMember[] = [
  { userId: "u1", email: "alice@example.com", name: "Alice Anderson" },
  { userId: "u2", email: "bob@example.com", name: null },
  { userId: "u3", email: null, name: null },
];

const NOW = Date.now();

const ATTACHMENTS: TaskAttachment[] = [
  {
    id: "a1",
    taskId: "t1",
    fileName: "spec.pdf",
    fileUrl: "t1/1-spec.pdf",
    uploadedBy: "u1",
    createdAt: new Date(NOW - 3600_000).toISOString(),
    mimeType: "application/pdf",
  },
  {
    id: "a2",
    taskId: "t1",
    fileName: "screenshot.png",
    fileUrl: "t1/2-screenshot.png",
    uploadedBy: "u2",
    createdAt: new Date(NOW - 1_000).toISOString(),
    mimeType: "image/png",
  },
];

function render(attachments: TaskAttachment[] = ATTACHMENTS) {
  return renderToStaticMarkup(
    createElement(AttachmentList, {
      taskId: "t1",
      attachments,
      members: MEMBERS,
    }),
  );
}

describe("AttachmentList (F066: AS-109)", () => {
  it("test_AS_109_attachment_list_shows_file_name_and_uploader", () => {
    const html = render();

    expect(html).toContain("spec.pdf");
    // u1 has a name -> name wins for the uploader label.
    expect(html).toContain("Alice Anderson");

    expect(html).toContain("screenshot.png");
    // u2 has no name -> falls back to email.
    expect(html).toContain("bob@example.com");
  });

  it("test_AS_109_empty_state_renders_when_there_are_no_attachments", () => {
    const html = render([]);

    expect(html).toContain("No attachments yet");
  });

  it("test_AS_109_unknown_uploader_falls_back_to_raw_user_id", () => {
    const html = render([
      {
        id: "a3",
        taskId: "t1",
        fileName: "notes.txt",
        fileUrl: "t1/3-notes.txt",
        uploadedBy: "u3",
        createdAt: new Date(NOW).toISOString(),
        mimeType: "text/plain",
      },
    ]);

    expect(html).toContain("notes.txt");
    // u3 has neither name nor email -> falls back to the raw user id.
    expect(html).toContain("u3");
  });
});

describe("appendAttachment (F066: AS-115)", () => {
  it("test_AS_115_successful_upload_appends_to_the_visible_list", () => {
    // Mirrors what AttachmentList's upload success handler does: take the
    // current local list plus the newly-returned attachment, and produce
    // the next list to render — no re-fetch, no reload.
    const newAttachment: TaskAttachment = {
      id: "a3",
      taskId: "t1",
      fileName: "new-file.pdf",
      fileUrl: "t1/3-new-file.pdf",
      uploadedBy: "u1",
      createdAt: new Date(NOW).toISOString(),
      mimeType: "application/pdf",
    };

    const next = appendAttachment(ATTACHMENTS, newAttachment);

    expect(next).toHaveLength(ATTACHMENTS.length + 1);
    expect(next.some((a) => a.id === "a3")).toBe(true);

    const html = renderToStaticMarkup(
      createElement(AttachmentList, {
        taskId: "t1",
        attachments: next,
        members: MEMBERS,
      }),
    );
    expect(html).toContain("new-file.pdf");
  });

  it("test_AS_115_duplicate_append_is_idempotent_by_id", () => {
    const [first] = ATTACHMENTS;
    const next = appendAttachment(ATTACHMENTS, first);

    // Appending an attachment whose id already exists must not duplicate
    // it in the visible list.
    expect(next).toHaveLength(ATTACHMENTS.length);
  });

  it("test_AS_115_append_to_empty_list_shows_the_uploaded_file_not_the_empty_state", () => {
    const uploaded: TaskAttachment = {
      id: "a1",
      taskId: "t1",
      fileName: "first-upload.png",
      fileUrl: "t1/1-first-upload.png",
      uploadedBy: "u2",
      createdAt: new Date(NOW).toISOString(),
      mimeType: "image/png",
    };

    const next = appendAttachment([], uploaded);
    const html = renderToStaticMarkup(
      createElement(AttachmentList, {
        taskId: "t1",
        attachments: next,
        members: MEMBERS,
      }),
    );

    expect(html).toContain("first-upload.png");
    expect(html).not.toContain("No attachments yet");
  });
});
