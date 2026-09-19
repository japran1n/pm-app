// Mission 20260919-150607, F023 (AS-082): documents the decision to KEEP the
// singular `setDisciplineEstimate` / `clearDisciplineEstimate` actions after
// `setDisciplineEstimatesBulk` (F021) became the popover's primary write
// path. They are not deprecated -- they remain a supported single-discipline
// API surface for other/future callers. This test asserts the exports still
// exist and are callable functions, so a future removal without updating
// this decision record will fail loudly here.
import { describe, expect, it } from "vitest";
import * as architectureActions from "@/lib/actions/architecture";
import * as estimateActions from "@/lib/actions/architecture/estimates";

describe("AS-082: singular discipline-estimate actions decision", () => {
  it("keeps setDisciplineEstimate exported and callable from the estimates module", () => {
    expect(typeof estimateActions.setDisciplineEstimate).toBe("function");
  });

  it("keeps clearDisciplineEstimate exported and callable from the estimates module", () => {
    expect(typeof estimateActions.clearDisciplineEstimate).toBe("function");
  });

  it("re-exports both singular actions from the architecture actions barrel", () => {
    expect(typeof architectureActions.setDisciplineEstimate).toBe("function");
    expect(typeof architectureActions.clearDisciplineEstimate).toBe("function");
  });

  it("keeps setDisciplineEstimatesBulk as the primary bulk action alongside the singulars", () => {
    expect(typeof estimateActions.setDisciplineEstimatesBulk).toBe("function");
  });
});
