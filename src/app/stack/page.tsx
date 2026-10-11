import type { Metadata } from "next";
import { ogImage } from "@/components/JsonLd";
import { WindowCard } from "@/components/WindowCard";

/** §8.2 Stack meta — title/description/canonical/OG/og:locale. */
export const metadata: Metadata = {
  title: "Stack - Maulana Faris",
  description: "Computer Science student at UGM, building web products end-to-end.",
  alternates: { canonical: "https://maulana.app/stack" },
  openGraph: {
    title: "Stack - Maulana Faris",
    description: "Computer Science student at UGM, building web products end-to-end.",
    url: "https://maulana.app/stack",
    locale: "en_US",
    type: "website",
    images: [{ url: ogImage(), width: 1200, height: 630 }],
  },
};

/**
 * Tech Stack / Uses page (§6.6).
 *
 * Four categories (Languages, Frameworks, Tools, Infra) — each a card with a
 * grid of items. Every item is text: a decorative pixel icon (inline SVG,
 * `shape-rendering: crispEdges`, integer coordinates, `aria-hidden`) + name +
 * level.
 *
 * Numbering is continuous 1..16 across the four categories so every slot maps
 * to exactly one cell.
 */
interface TechItem {
  name: string;
  level: string;
}

interface TechCategory {
  title: string;
  items: TechItem[];
}

const categories: TechCategory[] = [
  {
    title: "Languages",
    items: [
      { name: "TypeScript", level: "production" },
      { name: "JavaScript", level: "production" },
      { name: "Python", level: "working" },
      { name: "SQL", level: "working" },
    ],
  },
  {
    title: "Frameworks",
    items: [
      { name: "Next.js", level: "production" },
      { name: "React", level: "production" },
      { name: "Tailwind CSS", level: "production" },
      { name: "Node.js", level: "working" },
    ],
  },
  {
    title: "Tools",
    items: [
      { name: "Git", level: "production" },
      { name: "Docker", level: "working" },
      { name: "Vitest", level: "working" },
      { name: "Aseprite", level: "working" },
    ],
  },
  {
    title: "Infra",
    items: [
      { name: "Vercel", level: "production" },
      { name: "Supabase", level: "production" },
      { name: "PostgreSQL", level: "working" },
      { name: "GitHub Actions", level: "working" },
    ],
  },
];

/**
 * Decorative 16x16 pixel glyphs — rects only, integer coordinates.
 * Inline SVG carries no accessible name: `aria-hidden="true"` +
 * `focusable="false"` (the SVG equivalent of `alt=""` for a decorative
 * image; React's SVG typings reject `alt` on `<svg>`).
 */
function TechIcon({ index }: { index: number }) {
  const fill = "var(--accent-amber)";
  const muted = "var(--text-muted)";
  const shape = index % 4;

  return (
    <span className="stack-item__icon" aria-hidden="true">
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        shapeRendering="crispEdges"
        focusable="false"
        aria-hidden="true"
      >
        <rect x="0" y="0" width="16" height="16" fill="var(--surface-sunken)" />
        {shape === 0 && (
          <>
            <rect x="3" y="3" width="4" height="4" fill={fill} />
            <rect x="9" y="3" width="4" height="4" fill={muted} />
            <rect x="3" y="9" width="4" height="4" fill={muted} />
            <rect x="9" y="9" width="4" height="4" fill={fill} />
          </>
        )}
        {shape === 1 && (
          <>
            <rect x="3" y="3" width="10" height="2" fill={fill} />
            <rect x="3" y="7" width="7" height="2" fill={muted} />
            <rect x="3" y="11" width="4" height="2" fill={fill} />
          </>
        )}
        {shape === 2 && (
          <>
            <rect x="7" y="2" width="2" height="12" fill={muted} />
            <rect x="2" y="7" width="12" height="2" fill={fill} />
            <rect x="4" y="4" width="2" height="2" fill={muted} />
            <rect x="10" y="10" width="2" height="2" fill={muted} />
          </>
        )}
        {shape === 3 && (
          <>
            <rect x="5" y="3" width="6" height="6" fill={fill} />
            <rect x="3" y="9" width="10" height="2" fill={muted} />
            <rect x="5" y="12" width="6" height="1" fill={muted} />
          </>
        )}
      </svg>
    </span>
  );
}

export default function Stack() {
  return (
    <div className="stack">
      <header className="page-head">
        <p className="page-kicker">{"Web Developer"}</p>
        <h1 className="page-title">Stack</h1>
      </header>

      <div className="stack-grid" data-testid="stack-grid">
        {categories.map((category, categoryIndex) => (
          <WindowCard
            key={category.title}
            title={category.title}
            className="stack-card"
            headerRight={
              <span className="stack-card__count">
                {String(category.items.length).padStart(2, "0")}
              </span>
            }
          >
            <ul
              className="stack-items"
              aria-label={category.title}
              data-testid={`stack-category-${category.title.toLowerCase()}`}
            >
              {category.items.map((item, itemIndex) => (
                <li key={item.name} className="stack-item">
                  <TechIcon index={categoryIndex * 4 + itemIndex} />
                  <span className="stack-item__name">{item.name}</span>
                  {item.level && (
                    <span className="stack-item__level">{item.level}</span>
                  )}
                </li>
              ))}
            </ul>
          </WindowCard>
        ))}
      </div>
    </div>
  );
}
