// @vitest-environment jsdom
//
// Mission 20260917-170249, F030 (AS-124):
// collapsed-by-default help section explaining the converter's constraints.

import { describe, expect, it } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

import { ConverterHelp } from "./converter-help"

describe("ConverterHelp (F030)", () => {
  it("test_AS_124_help_content_hidden_by_default", () => {
    render(<ConverterHelp />)

    expect(screen.queryByText(/class selectors only/i)).not.toBeVisible()

    cleanup()
  })

  it("test_AS_124_clicking_toggle_shows_help_content", () => {
    render(<ConverterHelp />)

    const toggle = screen.getByText(/how this works/i)
    fireEvent.click(toggle)

    expect(screen.getByText(/class selectors only/i)).toBeVisible()

    cleanup()
  })

  it("test_AS_124_all_three_key_points_present_when_open", () => {
    render(<ConverterHelp />)

    const toggle = screen.getByText(/how this works/i)
    fireEvent.click(toggle)

    expect(screen.getByText(/class selectors only/i)).toBeVisible()
    expect(screen.getByText(/breakpoint pixel values/i)).toBeVisible()
    expect(screen.getByText(/images become empty blocks/i)).toBeVisible()

    expect(screen.getByText(/991px/)).toBeVisible()
    expect(screen.getByText(/767px/)).toBeVisible()
    expect(screen.getByText(/479px/)).toBeVisible()
    expect(screen.getByText(/1280px/)).toBeVisible()
    expect(screen.getByText(/1440px/)).toBeVisible()
    expect(screen.getByText(/1920px/)).toBeVisible()

    cleanup()
  })
})
