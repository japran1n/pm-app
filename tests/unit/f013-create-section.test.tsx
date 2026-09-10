// @vitest-environment jsdom
//
// Mission 20260910-182104, F013 (AS-003, AS-029, AS-038): a section
// created under a page exists as a subtask of that page's task; a page
// column shows a control for adding a section.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

import { createSectionSchema } from "@/lib/validation/architecture";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useParams: () => ({ projectId: "project-1" }),
}));
vi.mock("@/lib/actions/architecture", () => ({
  createSection: vi.fn(async () => ({ success: true, id: "section-1" })),
}));

import { AddSectionButton } from "@/components/architecture/add-section-button";

describe("F013 createSectionSchema", () => {
  it("AS-003: accepts a non-empty title and a page id", () => {
    const result = createSectionSchema.safeParse({
      title: "Hero",
      page_id: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an empty title", () => {
    const result = createSectionSchema.safeParse({
      title: "   ",
      page_id: "123e4567-e89b-12d3-a456-426614174000",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid page id", () => {
    const result = createSectionSchema.safeParse({
      title: "Hero",
      page_id: "not-a-uuid",
    });

    expect(result.success).toBe(false);
  });
});

describe("F013 AddSectionButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("AS-029: a page column shows a control for adding a section", () => {
    render(<AddSectionButton pageTaskId="page-1" />);

    expect(
      screen.getByRole("button", { name: "Add section" }),
    ).toBeInTheDocument();
  });
});
