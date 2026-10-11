import type { MetadataRoute } from "next";

/**
 * §8.4 crawl files — `robots.txt` allowing crawl, pointing to the sitemap.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
    },
    sitemap: "https://maulana.app/sitemap.xml",
  };
}
