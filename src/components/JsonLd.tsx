import type { Project } from "@/content/projects";

/**
 * §8.2–8.4 SEO helpers.
 *
 * The canonical domain is `maulana.app` and the OG image is `og.png`.
 *
 * Next's metadata resolver funnels og:image URLs through `new URL()`, which
 * would lowercase the URL and percent-encode characters. A `URL` subclass that
 * overrides `toString()` is returned untouched by `resolveUrl()` and serialized
 * verbatim by the meta renderer.
 */
const BASE = "https://maulana.app";
const OG_IMAGE_PATH = "og.png";

class RawUrl extends URL {
  private raw: string;

  constructor(raw: string) {
    super(raw);
    this.raw = raw;
  }

  toString(): string {
    return this.raw;
  }
}

/** og:image (§8.2) — 1200x630 social card. */
export function ogImage(): URL {
  return new RawUrl(`${BASE}/${OG_IMAGE_PATH}`);
}

/** §8.3 JSON-LD Person — Home/About. */
export function personJsonLd(url: string = `${BASE}/`): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Maulana Faris Al Ghifari",
    url,
    sameAs: ["https://github.com/MaulanaFarisA", "https://www.linkedin.com/in/maulanafaris", "https://www.instagram.com/maulanafariiss"],
  };
}

/** §8.3 JSON-LD WebSite with SearchAction — Home. */
export function webSiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Maulana Faris",
    url: `${BASE}/`,
    potentialAction: {
      "@type": "SearchAction",
      target: `${BASE}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

/** §8.3 JSON-LD CreativeWork — one per case study. */
export function creativeWorkJsonLd(project: Project): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: project.title,
    url: `${BASE}/work/${project.slug}`,
    description: project.overview.slice(0, 155),
    author: { "@type": "Person", name: "Maulana Faris Al Ghifari", url: `${BASE}/` },
  };
}

/**
 * Renders one `<script type="application/ld+json">` block. `<` is escaped to
 * `\u003c` so no value can terminate the script element early.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
