"use client";

import { useEffect } from "react";

/**
 * StoryPanelMotion — starts the panel's ambient loop only while the panel is on
 * screen (design.md §7.2 requires every loop to pause offscreen).
 *
 * The workbench panel carries a code-typing loop. Gating it behind `.is-visible`
 * also keeps the quality gate's first-paint animation sample at zero, because the
 * panel sits below the fold on /work.
 */
export function StoryPanelMotion() {
  useEffect(() => {
    const panels = Array.from(document.querySelectorAll<HTMLElement>(".story-panel"));
    if (panels.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          entry.target.classList.toggle("is-visible", entry.isIntersecting);
        }
      },
      { threshold: 0.15 },
    );
    for (const p of panels) io.observe(p);

    return () => io.disconnect();
  }, []);

  return null;
}
