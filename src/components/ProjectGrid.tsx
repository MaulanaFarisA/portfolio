import { EMPTY_WORK_MESSAGE, type Project } from "@/content/projects";
import { ProjectCard } from "@/components/ProjectCard";

interface ProjectGridProps {
  projects: Project[];
}

/**
 * ProjectGrid (§5.4) — grid behaviour by project count:
 *
 *   0   → single empty-state card with the empty-work message
 *   1–2 → full-width featured cards
 *   3–4 → 2x2 grid; an odd last card spans the full row (no stretched orphan)
 *   5+  → one featured row + remainder list
 */
export function ProjectGrid({ projects }: ProjectGridProps) {
  if (projects.length === 0) {
    return (
      <div className="project-grid">
        <div className="empty-work-card" data-testid="empty-work">
          <p className="empty-work-card__text">{EMPTY_WORK_MESSAGE}</p>
        </div>
      </div>
    );
  }

  if (projects.length <= 2) {
    return (
      <div className="project-grid project-grid--featured" data-testid="project-grid">
        {projects.map((project) => (
          <ProjectCard key={project.slug} project={project} featured />
        ))}
      </div>
    );
  }

  if (projects.length <= 4) {
    const odd = projects.length % 2 === 1;
    return (
      <div className="project-grid project-grid--quad" data-testid="project-grid">
        {projects.map((project, index) => (
          <ProjectCard
            key={project.slug}
            project={project}
            className={
              odd && index === projects.length - 1 ? "project-card--span" : undefined
            }
          />
        ))}
      </div>
    );
  }

  const [lead, ...rest] = projects;
  return (
    <>
      <div className="project-grid project-grid--lead" data-testid="project-grid">
        <ProjectCard project={lead} featured />
      </div>
      <div className="project-list" data-testid="project-list">
        {rest.map((project) => (
          <ProjectCard key={project.slug} project={project} />
        ))}
      </div>
    </>
  );
}
