import type { MetadataRoute } from "next";
import { isPublishable, projects } from "@/content/projects";

/**
 * §8.4 crawl files — `sitemap.xml` listing all routes.
 *
 * Routes: `/`, `/work`, `/work/<slug>` (publishable case studies only,
 * mirroring `generateStaticParams`), `/about`, `/stack`, `/contact`.
 */
const BASE_URL = "https://maulana.app";

export default function sitemap(): MetadataRoute.Sitemap {
  const caseStudies = projects
    .filter(isPublishable)
    .map((project) => `/work/${project.slug}`);

  const routes = ["/", "/work", ...caseStudies, "/about", "/stack", "/contact"];

  return routes.map((route) => ({
    url: `${BASE_URL}${route}`,
  }));
}
