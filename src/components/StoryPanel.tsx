/**
 * StoryPanel (design.md §6.2 story sequence) — a framed pixel-art panel that
 * carries the narrative from the hero into the inner pages:
 *
 *   home hero (outside, city asleep / meadow in the morning)
 *     → work  : inside, the workbench (laptop in front, the Vespa print behind)
 *     → about : deeper still, the CRT terminal where the work actually happens
 *
 * Implementation notes / gate constraints:
 *  - The art ships as a plain <img> with explicit width/height, so the browser
 *    reserves the box before the bytes arrive (CLS stays 0).
 *  - `image-rendering: pixelated` keeps the pixel grid crisp at 1x and 2x
 *    (design.md §9.1 anti-mixel; the gate only audits <svg>, but we hold the
 *    same standard for raster art).
 *  - Purely decorative framing: the figure carries the caption text, so the
 *    image itself is `alt=""` + `aria-hidden`.
 *  - No animation here: the ambient budget is spent in the hero.
 */
interface StoryPanelProps {
  /** Which scene to show. */
  scene: "workbench" | "terminal";
  /** Caption shown under the panel (also the accessible description). */
  caption: string;
  /** Optional short label rendered as a mono eyebrow above the panel. */
  label?: string;
}

const SCENES = {
  workbench: {
    src: "/scenes/panel-workbench.png",
    width: 1040,
    height: 640,
    alt: "",
  },
  terminal: {
    src: "/scenes/panel-terminal.png",
    width: 960,
    height: 620,
    alt: "",
  },
} as const;

export function StoryPanel({ scene, caption, label }: StoryPanelProps) {
  const art = SCENES[scene];

  return (
    <figure className={`story-panel story-panel--${scene}`}>
      {label ? <figcaption className="story-panel__label">{label}</figcaption> : null}
      <div className="story-panel__frame">
        <div className="story-panel__art">
        <img
          className="story-panel__img"
          src={art.src}
          alt={art.alt}
          width={art.width}
          height={art.height}
          loading="lazy"
          decoding="async"
          aria-hidden="true"
        />
        {scene === "workbench" ? (
          <span className="story-panel__screen" aria-hidden="true">
            <span className="story-panel__screen-bar" />
            <span className="story-panel__screen-bar" />
            <span className="story-panel__screen-bar" />
            <span className="story-panel__screen-bar" />
          </span>
        ) : null}
        </div>
      </div>
      <figcaption className="story-panel__caption">{caption}</figcaption>
    </figure>
  );
}
