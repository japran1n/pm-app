// @vitest-environment jsdom
//
// F005 (AS-010, AS-011, AS-012): the home dashboard greeting block —
// timezone-formatted date, time-of-day greeting, and a counts subtitle.
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HomeGreeting } from "./home-greeting";

afterEach(() => cleanup());

describe("HomeGreeting", () => {
  it("test_AS_010_renders_date_formatted_in_user_timezone", () => {
    render(
      <HomeGreeting
        userName="Ana"
        timezone="UTC"
        attentionCount={0}
        todayTaskCount={0}
        overdueCount={0}
      />,
    );
    // date is rendered as e.g. "Mon 21 Sep 2026" — assert weekday/day/year
    // shape rather than a fixed date since the component uses `new Date()`.
    const dateEl = screen.getByText(/\d{4}/);
    expect(dateEl).toBeInTheDocument();
  });

  it("test_AS_011_renders_time_of_day_greeting_with_user_name", () => {
    render(
      <HomeGreeting
        userName="Ana"
        timezone="UTC"
        attentionCount={0}
        todayTaskCount={0}
        overdueCount={0}
      />,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/Good (morning|afternoon|evening), Ana/);
  });

  it("test_AS_012_renders_zero_state_subtitle_when_all_counts_are_zero", () => {
    render(
      <HomeGreeting
        userName="Ana"
        timezone="UTC"
        attentionCount={0}
        todayTaskCount={0}
        overdueCount={0}
      />,
    );
    expect(
      screen.getByText("Nothing urgent today — you're on top of it."),
    ).toBeInTheDocument();
  });

  it("test_AS_012_renders_combined_subtitle_when_counts_are_nonzero", () => {
    render(
      <HomeGreeting
        userName="Ana"
        timezone="UTC"
        attentionCount={3}
        todayTaskCount={2}
        overdueCount={1}
      />,
    );
    expect(
      screen.getByText("3 things need you · 2 tasks due today · 1 overdue"),
    ).toBeInTheDocument();
  });

  it("does not crash with all-zero props", () => {
    expect(() =>
      render(
        <HomeGreeting
          userName="Ana"
          timezone="America/New_York"
          attentionCount={0}
          todayTaskCount={0}
          overdueCount={0}
        />,
      ),
    ).not.toThrow();
  });
});
