import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { JsonLd, creativeWorkJsonLd, ogImage } from "@/components/JsonLd";
import { getProjectBySlug, isPublishable, projects } from "@/content/projects";

interface CaseStudyPageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return projects.filter(isPublishable).map((project) => ({ slug: project.slug }));
}

/** §8.2 Case study meta + §8.3 CreativeWork JSON-LD. */
export async function generateMetadata({ params }: CaseStudyPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!isPublishable(project)) return {};
  const title = `${project.title} - Maulana Faris`;
  const description = project.overview.slice(0, 155);
  return {
    title,
    description,
    alternates: { canonical: `https://maulana.app/work/${project.slug}` },
    openGraph: {
      title,
      description,
      url: `https://maulana.app/work/${project.slug}`,
      locale: "en_US",
      type: "article",
      images: [{ url: ogImage(), width: 1200, height: 630 }],
    },
  };
}

/**
 * Case study template (§6.4) — content contract, in order:
 * Overview, Problem, Constraints (optional), Role, Key Decision, Solution,
 * Outcome, Reflection (optional), Gallery, Stack, Links.
 * A project with no Outcome is not published (§6.4): notFound().
 */
export default async function CaseStudyPage({ params }: CaseStudyPageProps) {
  const { slug } = await params;
  const project = getProjectBySlug(slug);
  if (!isPublishable(project)) notFound();

  const slotIndex = projects.findIndex((p) => p.slug === project.slug) + 1;
  const imageSlot = `{{PROJECT_${slotIndex}_IMAGE}}`;
  const linkSlot = `{{PROJECT_${slotIndex}_LINK}}`;

  return (
    <article className="case-study">
      <JsonLd data={creativeWorkJsonLd(project)} />
      <header className="case-study__head">
        <Link href="/work" className="case-back">
          ← All work
        </Link>
        <h1 className="page-title">{project.title}</h1>
        <div className="case-meta">
          <span>{project.role}</span>
          <span aria-hidden="true">·</span>
          <span>{project.year}</span>
        </div>
      </header>

      <section className="case-section" data-case-section="overview">
        <h2 className="case-section__title">Overview</h2>
        <p className="case-section__body">{project.overview}</p>
      </section>

      <section className="case-section" data-case-section="problem">
        <h2 className="case-section__title">Problem</h2>
        <p className="case-section__body">{project.problem}</p>
      </section>

      {project.constraints ? (
        <section className="case-section" data-case-section="constraints">
          <h2 className="case-section__title">Constraints</h2>
          <p className="case-section__body">{project.constraints}</p>
        </section>
      ) : null}

      <section className="case-section" data-case-section="role">
        <h2 className="case-section__title">Role</h2>
        <p className="case-section__body">{project.role}</p>
      </section>

      <section className="case-section" data-case-section="decision">
        <h2 className="case-section__title">Key Decision</h2>
        <p className="case-section__body">{project.decision}</p>
      </section>

      <section className="case-section" data-case-section="solution">
        <h2 className="case-section__title">Solution</h2>
        <p className="case-section__body">{project.solution}</p>
      </section>

      <section className="case-section" data-case-section="outcome">
        <h2 className="case-section__title">Outcome</h2>
        <p className="case-section__body">{project.outcome}</p>
      </section>

      {project.reflection ? (
        <section className="case-section" data-case-section="reflection">
          <h2 className="case-section__title">Reflection</h2>
          <p className="case-section__body">{project.reflection}</p>
        </section>
      ) : null}

      <section className="case-section" data-case-section="gallery">
        <h2 className="case-section__title">Gallery</h2>
        <div className="case-gallery">
          {project.image ? (
            <figure className="case-gallery__figure">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                className="case-gallery__img"
                src={project.image}
                alt=""
                width={640}
                height={400}
              />
            </figure>
          ) : (
            <figure className="case-gallery__figure">
              <span>{imageSlot}</span>
            </figure>
          )}
        </div>
      </section>

      <section className="case-section" data-case-section="stack">
        <h2 className="case-section__title">Stack</h2>
        <ul className="case-stack">
          {project.stack.map((item, index) => (
            <li className="case-stack__item" key={`${item}-${index}`}>
              {item}
            </li>
          ))}
        </ul>
      </section>

      <section className="case-section" data-case-section="links">
        <h2 className="case-section__title">Links</h2>
        <ul className="case-links">
          {project.link ? (
            <li className="case-links__item">
              <a className="case-links__anchor" href={project.link} rel="noopener noreferrer">
                {project.link}
              </a>
            </li>
          ) : (
            <li className="case-links__item">
              <span>{linkSlot}</span>
            </li>
          )}
        </ul>
      </section>
    </article>
  );
}
