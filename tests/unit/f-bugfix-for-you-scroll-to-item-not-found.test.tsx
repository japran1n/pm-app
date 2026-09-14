// @vitest-environment jsdom
//
// Portal polish follow-up (AS-011): a stale `?approvalId=` link into "For
// you" (the decision was already decided, or is filtered out of the
// current view) previously scrolled to nothing and told the client
// nothing -- indistinguishable from a slow page load. `ForYouScrollToItem`
// now renders an inline banner when its target row isn't in the DOM.
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";

import { ForYouScrollToItem } from "@/components/portal/for-you-scroll-to-item";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AS-011: For you scroll-to-item gives a hint on a stale link", () => {
  it("test_AS_011_shows_inline_banner_when_the_target_row_is_not_in_the_dom", () => {
    render(createElement(ForYouScrollToItem, { targetId: "approval-does-not-exist" }));

    expect(
      screen.getByText("That decision has already been handled — see it in the history below."),
    ).toBeInTheDocument();
  });

  it("test_AS_011_renders_nothing_when_the_target_row_is_present", () => {
    const target = document.createElement("li");
    target.id = "approval-real-id";
    // jsdom doesn't implement scrollIntoView.
    target.scrollIntoView = () => {};
    document.body.appendChild(target);

    const { container } = render(
      createElement(ForYouScrollToItem, { targetId: "approval-real-id" }),
    );

    expect(
      screen.queryByText("That decision has already been handled — see it in the history below."),
    ).not.toBeInTheDocument();
    // The component itself renders no visible wrapper in this case.
    expect(container).toBeEmptyDOMElement();
  });
});
