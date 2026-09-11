// Unit tests for F074 (lib/actions/brief.ts): covers AS-145 (the team
// can request approval of the brief document) and AS-146 (an approval
// request for a brief records the document as its subject).
//
// `requestBriefApproval` itself calls `createClient()` from
// `@/lib/supabase/server`, which needs a real request context --
// exercising it against a live Supabase project is an integration
// concern, matching F048/F049/F071's documented precedent
// (tests/unit/f048-brief-query.test.ts, tests/unit/
// f049-brief-question-crud.test.ts, tests/unit/
// f071-generate-brief-document.test.ts). This file verifies the
// module's public surface (AS-145: the action exists and can be called)
// and, directly against the pure `buildBriefApprovalRequestPayload`
// helper (extracted for exactly this reason), the subject-recording
// shape AS-146 requires -- deriving expectations from the assertion
// text ("records the document as its subject"), not from how the
// action happens to call Supabase.

import { describe, expect, it } from "vitest";
import * as briefActions from "@/lib/actions/brief";

describe("F074 AS-145: the team can request approval of the brief document", () => {
  it("exports requestBriefApproval", () => {
    expect(typeof briefActions.requestBriefApproval).toBe("function");
  });
});

describe("F074 AS-146: an approval request for a brief records the document as its subject", () => {
  it("builds a payload whose subject is the brief document (subject_type 'doc', subject_id = docId)", () => {
    const payload = briefActions.buildBriefApprovalRequestPayload(
      "project-1",
      "doc-1",
      "user-1",
    );

    expect(payload.subject_type).toBe("doc");
    expect(payload.subject_id).toBe("doc-1");
  });

  it("scopes the request to the given project and records who requested it", () => {
    const payload = briefActions.buildBriefApprovalRequestPayload(
      "project-1",
      "doc-1",
      "user-1",
    );

    expect(payload.project_id).toBe("project-1");
    expect(payload.requested_by).toBe("user-1");
  });

  it("produces a different subject_id for a different document, never a hardcoded value", () => {
    const payloadA = briefActions.buildBriefApprovalRequestPayload(
      "project-1",
      "doc-a",
      "user-1",
    );
    const payloadB = briefActions.buildBriefApprovalRequestPayload(
      "project-1",
      "doc-b",
      "user-1",
    );

    expect(payloadA.subject_id).toBe("doc-a");
    expect(payloadB.subject_id).toBe("doc-b");
    expect(payloadA.subject_id).not.toBe(payloadB.subject_id);
  });
});
