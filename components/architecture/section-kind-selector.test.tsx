// @vitest-environment jsdom
//
// Mission 20260919-150607, F005 (AS-025, AS-026): SectionKindSelector
// renders as a popover with static/cms radio options and reports the
// selected kind back to the caller.
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SectionKindSelector } from "./section-kind-selector";

afterEach(() => {
  cleanup();
});

describe("SectionKindSelector", () => {
  it("test_AS_025_section_kind_selector_renders_without_error", () => {
    render(<SectionKindSelector value="static" onChange={() => {}} />);

    const trigger = screen.getByRole("button", { name: "Change section kind" });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent("Static");
  });

  it("test_AS_025_opens_popover_with_static_and_cms_radio_options", () => {
    render(<SectionKindSelector value="static" onChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Change section kind" }));

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("Static");
    expect(options[1]).toHaveTextContent("CMS");
  });

  it("test_AS_026_onchange_fires_with_correct_kind_value_when_option_selected", () => {
    const onChange = vi.fn();
    render(<SectionKindSelector value="static" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Change section kind" }));
    fireEvent.click(screen.getByRole("option", { name: /cms/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("cms");
  });

  it("test_AS_026_onchange_does_not_fire_when_selecting_the_current_kind", () => {
    const onChange = vi.fn();
    render(<SectionKindSelector value="cms" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Change section kind" }));
    fireEvent.click(screen.getByRole("option", { name: /cms/i }));

    expect(onChange).not.toHaveBeenCalled();
  });
});
