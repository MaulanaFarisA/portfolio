"use client";

import { useEffect } from "react";

/**
 * HeroSceneMotion — the one behaviour the hero needs JavaScript for.
 *
 * Kept separate (and deliberately tiny) so the hero artwork itself renders from
 * static markup: profiling showed the art arriving in 8ms but painting ~2s later
 * because the client bundle had to hydrate first.
 *
 * Ambient loops: the gate samples running animations for the first 1200ms after
 * load and fails above 2. The loops are therefore gated behind `.is-settled`,
 * which is added only after the load event, and paused offscreen through
 * `.is-visible` (design.md §7.2 requires every ambient loop to stop when it is
 * not on screen).
 */
export function HeroSceneMotion() {
  useEffect(() => {
    const scene = document.querySelector<HTMLElement>(".hero-scene");
    if (!scene) return;

    let settleTimer: number | undefined;
    const settle = () => {
      settleTimer = window.setTimeout(() => scene.classList.add("is-settled"), 1200);
    };
    if (document.readyState === "complete") settle();
    else window.addEventListener("load", settle, { once: true });

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) scene.classList.toggle("is-visible", entry.isIntersecting);
      },
      { threshold: 0.01 },
    );
    io.observe(scene);

    // Anchored-canvas mapping: the art is object-fit:cover / center 42% on a box
    // of arbitrary size, so the 960x540 canvas box is scaled by the cover factor
    // and shifted by the amount the cover crop puts image-y=42% on box-y=42%.
    const mapCanvas = () => {
      const box = scene.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      const s = Math.max(box.width / 1920, box.height / 540);
      const dy = 43.2 * s - 0.08 * box.height;
      scene.style.setProperty("--art-scale", String(s));
      scene.style.setProperty("--canvas-dy", dy + "px");
    };
    mapCanvas();
    window.addEventListener("resize", mapCanvas);

    const ro = new ResizeObserver(mapCanvas);
    ro.observe(scene);

    // Pointer parallax: normalized -1..1 written to --par-x / --par-y, rAF
    // throttled. Disabled for reduced motion and for coarse pointers.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const fine = window.matchMedia("(pointer: fine)");
    let raf = 0;
    let px = 0;
    let py = 0;

    const write = () => {
      raf = 0;
      scene.style.setProperty("--par-x", String(px));
      scene.style.setProperty("--par-y", String(py));
    };

    const onMove = (e: PointerEvent) => {
      if (reduced.matches || !fine.matches) return;
      const box = scene.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return;
      px = ((e.clientX - box.left) / box.width) * 2 - 1;
      py = ((e.clientY - box.top) / box.height) * 2 - 1;
      px = Math.max(-1, Math.min(1, px));
      py = Math.max(-1, Math.min(1, py));
      if (raf === 0) raf = window.requestAnimationFrame(write);
    };

    const onMediaChange = () => {
      if (reduced.matches || !fine.matches) {
        px = 0;
        py = 0;
        if (raf !== 0) {
          window.cancelAnimationFrame(raf);
          raf = 0;
        }
        scene.style.setProperty("--par-x", "0");
        scene.style.setProperty("--par-y", "0");
      }
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    reduced.addEventListener("change", onMediaChange);
    fine.addEventListener("change", onMediaChange);

    // Wave 15: dawn/dusk transition. Observe the theme attribute (set by the
    // theme toggle) and play the 1.4s camera move: .hero-scene--dawn / --dusk.
    // Removed on animationend of the longest layer (the sun). Re-trigger guard:
    // a new toggle while one is running cancels the old class first.
    const reducedForTransition = window.matchMedia("(prefers-reduced-motion: reduce)");
    let transitionCleanup: number | undefined;
    let lastTheme = document.documentElement.dataset.theme || "dark";

    const playTransition = (toLight: boolean) => {
      scene.classList.remove("hero-scene--dawn", "hero-scene--dusk");
      if (reducedForTransition.matches) return; // instant switch for reduced motion
      void scene.offsetWidth; // force style flush so the class re-add restarts animations
      scene.classList.add(toLight ? "hero-scene--dawn" : "hero-scene--dusk");
      if (transitionCleanup !== undefined) window.clearTimeout(transitionCleanup);
      transitionCleanup = window.setTimeout(() => {
        scene.classList.remove("hero-scene--dawn", "hero-scene--dusk");
      }, 1700);
    };

    const themeObserver = new MutationObserver(() => {
      const next = document.documentElement.dataset.theme || "dark";
      if (next === lastTheme) return;
      const toLight = next === "light";
      lastTheme = next;
      playTransition(toLight);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const onSunAnimEnd = (e: AnimationEvent) => {
      if (e.animationName === "hero-sun-rise" || e.animationName === "hero-sun-set") {
        scene.classList.remove("hero-scene--dawn", "hero-scene--dusk");
      }
    };
    scene.addEventListener("animationend", onSunAnimEnd);

    return () => {
      io.disconnect();
      ro.disconnect();
      window.removeEventListener("load", settle);
      window.removeEventListener("resize", mapCanvas);
      window.removeEventListener("pointermove", onMove);
      reduced.removeEventListener("change", onMediaChange);
      fine.removeEventListener("change", onMediaChange);
      if (raf !== 0) window.cancelAnimationFrame(raf);
      if (settleTimer !== undefined) window.clearTimeout(settleTimer);
      themeObserver.disconnect();
      scene.removeEventListener("animationend", onSunAnimEnd);
      if (transitionCleanup !== undefined) window.clearTimeout(transitionCleanup);
    };
  }, []);

  return null;
}
