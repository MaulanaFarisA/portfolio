import Link from "next/link";

export default function NotFound() {
  return (
    <section className="not-found" aria-labelledby="not-found-title">
      <meta name="robots" content="noindex" />

      <svg
        className="not-found__scene"
        viewBox="0 0 80 48"
        width="240"
        height="144"
        shapeRendering="crispEdges"
        role="img"
        aria-label="Pixel art scene of a 404 sign floating over an empty grid"
      >
        <rect
          x="0"
          y="0"
          width="80"
          height="48"
          fill="var(--surface-sunken)"
        />

        {/* stars */}
        <rect x="8" y="4" width="2" height="2" fill="var(--text-muted)" />
        <rect x="66" y="2" width="2" height="2" fill="var(--text-muted)" />
        <rect x="72" y="10" width="2" height="2" fill="var(--text-muted)" />
        <rect x="14" y="14" width="2" height="2" fill="var(--text-muted)" />
        <rect x="60" y="6" width="2" height="2" fill="var(--text-muted)" />

        {/* glyph "4" */}
        <rect x="4" y="6" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="4" y="12" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="4" y="18" width="18" height="6" fill="var(--accent-amber)" />
        <rect x="16" y="6" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="16" y="12" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="16" y="24" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="16" y="30" width="6" height="6" fill="var(--accent-amber)" />

        {/* glyph "0" */}
        <rect x="28" y="6" width="18" height="6" fill="var(--accent-amber)" />
        <rect x="28" y="12" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="40" y="12" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="28" y="18" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="40" y="18" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="28" y="24" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="40" y="24" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="28" y="30" width="18" height="6" fill="var(--accent-amber)" />

        {/* glyph "4" */}
        <rect x="52" y="6" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="52" y="12" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="52" y="18" width="18" height="6" fill="var(--accent-amber)" />
        <rect x="64" y="6" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="64" y="12" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="64" y="24" width="6" height="6" fill="var(--accent-amber)" />
        <rect x="64" y="30" width="6" height="6" fill="var(--accent-amber)" />

        {/* ground line */}
        <rect x="0" y="40" width="80" height="2" fill="var(--border-default)" />
        <rect x="0" y="44" width="80" height="2" fill="var(--border-default)" />
      </svg>

      <h1 id="not-found-title" className="not-found__title">
        404
      </h1>

      <p className="not-found__message">
        PAGE NOT FOUND - this sector of the grid is empty.
      </p>

      <Link className="neo-pixel-btn neo-pixel-btn--sm" href="/">
        {"\u2190"} BACK TO HOME
      </Link>
    </section>
  );
}
