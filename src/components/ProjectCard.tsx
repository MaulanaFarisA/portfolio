import Link from "next/link";
import type { Project } from "@/content/projects";

interface ProjectCardProps {
  project: Project;
  /** Featured cards render taller/lead the grid (§5.4). */
  featured?: boolean;
  /** Extra classes for grid-count variants (e.g. orphan span, §5.4). */
  className?: string;
}

/**
 * ProjectCard (§6.3)
 *
 * - The whole card is ONE <Link>; accessible name = the title.
 * - Thumbnail wrapper locks `aspect-ratio: 16/10` (CLS = 0, §8.5).
 * - Structure: thumbnail + tag row + <h2> title + one-line description + year.
 * - Hover: translateY(-2px) + border → border-strong, 120ms steps(2).
 *   No lift on touch: the lift lives inside `@media (hover: hover)`.
 * - Focus-visible ring mirrors the hover treatment (§7.2 interaction parity).
 * - `prefetch={false}`: the grid renders several cards above/below the fold on
 *   `/` and `/work`, so Next's viewport-triggered prefetch fires 3–4 RSC
 *   fetches (≈40 KB) during the critical initial load, competing for the
 *   throttled mobile connection and delaying the LCP element's render. Card
 *   routes are prefetched on hover/intent instead (client nav stays instant
 *   on pointer devices; on touch the route resolves on tap as usual).
 */
export function ProjectCard({ project, featured = false, className }: ProjectCardProps) {
  const classes = [
    "project-card",
    featured ? "project-card--featured" : "project-card--compact",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Link
      href={`/work/${project.slug}`}
      prefetch={false}
      className={classes}
      data-testid="project-card"
      data-featured={featured ? "true" : "false"}
    >
      <div className="project-card__thumb" data-testid="project-thumbnail">
        {project.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={project.image}
            alt=""
            className="project-card__thumb-img"
            width={1600}
            height={1000}
          />
        ) : (
          <span className="project-card__thumb-placeholder" aria-hidden="true">
            {project.year}
          </span>
        )}
      </div>

      <div className="project-card__body">
        <div className="project-card__tags">
          {project.tags.map((tag, index) => (
            <span className="project-card__tag" key={`${tag}-${index}`}>
              {tag}
            </span>
          ))}
        </div>

        <h2 className="project-card__title">{project.title}</h2>
        <span className="project-card__desc">{project.description}</span>

        <div className="project-card__meta">
          <span className="project-card__year">{project.year}</span>
          <span className="project-card__arrow" aria-hidden="true">
            →
          </span>
        </div>
      </div>
    </Link>
  );
}
