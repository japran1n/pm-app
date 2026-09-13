"use client";

import { useEffect, useRef } from "react";

// Mission 20260910-182104, F033 (AS-070...AS-074): hover-linked component
// highlighting, extracted from components/architecture/board.tsx so the
// canvas view (canvas-board.tsx) gets the identical behaviour rather than
// a second, drifting copy.
//
// Standing decision 9 requires this to stay CSS-driven: a board of 480
// cards must not re-render on pointer move, so nothing here touches React
// state. The listener writes `data-hover-component="<id>"` on the root and
// `data-component-active="true"` on every card sharing that id; the
// matching selectors live in app/globals.css and only change
// border/background colours (AS-074).
//
// Sections with no linked component never carry `data-component`
// (section-card.tsx), so hovering one resolves to an empty id -- the CSS
// guard `:not([data-hover-component=""])` keeps every card inert (AS-072).
export function useComponentHover<T extends HTMLElement>() {
  const rootRef = useRef<T>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    function setActive(componentId: string) {
      if (!root) return;
      root.setAttribute("data-hover-component", componentId);
      root.querySelectorAll<HTMLElement>("[data-component]").forEach((el) => {
        if (componentId && el.dataset.component === componentId) {
          el.dataset.componentActive = "true";
        } else {
          delete el.dataset.componentActive;
        }
      });
    }

    function clearActive() {
      if (!root) return;
      root.removeAttribute("data-hover-component");
      root.querySelectorAll<HTMLElement>("[data-component]").forEach((el) => {
        delete el.dataset.componentActive;
      });
    }

    function handleMouseOver(event: MouseEvent) {
      const card = (event.target as Element).closest<HTMLElement>("[data-component]");
      setActive(card?.dataset.component ?? "");
    }

    root.addEventListener("mouseover", handleMouseOver);
    root.addEventListener("mouseleave", clearActive);

    return () => {
      root.removeEventListener("mouseover", handleMouseOver);
      root.removeEventListener("mouseleave", clearActive);
    };
  }, []);

  return rootRef;
}
