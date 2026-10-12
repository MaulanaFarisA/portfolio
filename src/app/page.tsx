import Link from "next/link";
import { ProjectGrid } from "@/components/ProjectGrid";
import { JsonLd, ogImage, personJsonLd, webSiteJsonLd } from "@/components/JsonLd";
import { projects } from "@/content/projects";
import { HeroScene } from "@/components/HeroScene";
import { HeroSceneMotion } from "@/components/HeroSceneMotion";
import type { Metadata } from "next";

/** §8.2 Home meta + §8.3 Person/WebSite JSON-LD. */
export const metadata: Metadata = {
  title: "Maulana Faris Al Ghifari - Computer Science Student at UGM",
  description: "Maulana Faris Al Ghifari - Computer Science student at UGM, building web products end-to-end. Intern at Kominfo Kulon Progo and Dinas Pariwisata Kulon Progo.",
  alternates: { canonical: "https://maulana.app/" },
  openGraph: {
    title: "Maulana Faris Al Ghifari - Computer Science Student at UGM",
    description: "Maulana Faris Al Ghifari - Computer Science student at UGM, building web products end-to-end. Intern at Kominfo Kulon Progo and Dinas Pariwisata Kulon Progo.",
    url: "https://maulana.app/",
    locale: "en_US",
    type: "website",
    images: [{ url: ogImage(), width: 1200, height: 630 }],
  },
};

/**
 * Home page (§6.2 hero + featured work §5.4).
 *
 * The <h1> is the LCP element: server-rendered real text, never animated
 * (§6.2, §7.2, §8.5). Subhead and CTAs fade/slide in at 400ms steps(4),
 * staggered 60ms — via CSS `animation-delay` on transform/opacity only.
 */
const roles = [
  { label: "Web Developer", icon: "M2 1h1v1H2zM1 2h1v1H1zM0 3h1v1H0zM1 4h1v1H1zM2 5h1v1H2zM5 1h1v1H5zM6 2h1v1H6zM7 3h1v1H7zM6 4h1v1H6zM5 5h1v1H5z" },
  { label: "Event Management", icon: "M1 0h1v2H1zM6 0h1v2H6zM0 2h8v1H0zM0 3h1v4H0zM7 3h1v4H7zM0 7h8v1H0zM3 4h2v1H3zM3 5h2v1H3z" },
  { label: "Public Speaking", icon: "M3 0h2v1H3zM3 1h2v3H3zM2 4h4v1H2zM3 5h2v1H3zM2 6h4v1H2z" },
  { label: "Cybersecurity", icon: "M3 0h2v1H3zM2 1h4v1H2zM2 2h4v1H2zM2 3h4v1H2zM3 4h2v1H3zM3 5h2v1H3z" },
  { label: "Team Lead", icon: "M1 1h2v2H1zM0 3h4v2H0zM5 1h2v1H5zM4 3h3v2H4z" },
  { label: "Fun", icon: "M2 2h4v1H2zM1 3h6v2H1zM2 5h4v1H2zM3 3h1v1H3zM5 3h1v1H5z" },
] as const;

export default function Home() {
  const featured = projects.filter((project) => project.featured);

  return (
    <div className="home">
      <JsonLd data={personJsonLd()} />
      <JsonLd data={webSiteJsonLd()} />
      {/* ── Hero (§6.2) ─────────────────────────────────────────────── */}
      <section className="home-hero" aria-labelledby="home-hero-title">
        <HeroScene />
        <HeroSceneMotion />
        <div className="home-hero__inner">
          <div className="home-hero__eyebrow">
            <span className="home-hero__sprite" aria-hidden="true">
              <svg
                width="32"
                height="32"
                viewBox="0 0 16 16"
                shapeRendering="crispEdges"
                focusable="false"
              >
                <rect x="0" y="0" width="16" height="16" fill="var(--surface-sunken)" />
                <rect x="2" y="2" width="12" height="12" fill="var(--accent-amber)" />
                <rect x="6" y="6" width="4" height="4" fill="var(--surface-canvas)" />
              </svg>
            </span>
            <p className="home-hero__kicker">{"Web Developer"}</p>
          </div>
          <h1 id="home-hero-title" className="home-hero__title">
            {"Maulana Faris Al Ghifari"}
          </h1>
          <p className="home-hero__subhead">
            {"Computer Science student at UGM, building web products end-to-end."}
          </p>
          <div className="home-hero__ctas">
            <Link href="/work" prefetch={false} className="neo-pixel-btn">
              View Work
            </Link>
            <Link href="/contact" prefetch={false} className="neo-pixel-btn neo-pixel-btn--secondary">
              Contact
            </Link>
          </div>
        </div>
      </section>

      {/* ── Intro (W17): face + pitch + role badges — the hook before work ── */}
      <section className="home-intro" aria-labelledby="home-intro-title">
        <div className="home-intro__card">
          <div className="home-intro__avatar">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/avatar.jpg"
              alt="Portrait of Maulana Faris Al Ghifari"
              width={176}
              height={176}
            />
          </div>
          <div className="home-intro__body">
            <h2 id="home-intro-title" className="home-intro__title">
              {"Hi, I'm Maulana Faris Al Ghifari."}
            </h2>
            <p className="home-intro__text">
              {"I build web products end-to-end, lead event teams at OmahTI UGM, and speak on stage. I care a lot about security, and I'm currently open to internships."}
            </p>
          </div>
        </div>
        <ul className="home-intro__roles" aria-label="What I do">
          {roles.map((role) => (
            <li key={role.label} className="home-intro__role">
              <svg
                width="16"
                height="16"
                viewBox="0 0 8 8"
                fill="currentColor"
                shapeRendering="crispEdges"
                aria-hidden="true"
              >
                <path d={role.icon} />
              </svg>
              {role.label}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Featured work (§5.4 counts 1–2 → full-width featured) ───── */}
      <section className="home-work" aria-labelledby="home-work-title">
        <div className="home-section-head">
          <h2 id="home-work-title" className="home-section-title">
            Selected Work
          </h2>
          <Link href="/work" prefetch={false} className="home-section-link">
            All projects →
          </Link>
        </div>
        <ProjectGrid projects={featured} />
      </section>

      {/* ── Bio (§6.5 placeholder copy slot) ────────────────────────── */}
      <section className="home-bio" aria-labelledby="home-bio-title">
        <h2 id="home-bio-title" className="home-section-title">
          About
        </h2>
        <p className="home-bio__text">{"I'm a Computer Science student at Universitas Gadjah Mada, Yogyakarta, building web products end-to-end and learning how to break them, too. I'm a Bakti BCA 2026 scholarship awardee, selected from 700 students across 20 universities. Over the past two years I've shipped production platforms: Buku Tahu, a bookkeeping app for tofu SMEs, and the Jemparingan QR scoring system, both live. I built core sections of the APECX 2026 platform and co-authored two cybersecurity training modules for IndoCEISS. As an intern at Kominfo Kulon Progo and Dinas Pariwisata Kulon Progo, I'm leading a 6-person team rebuilding the regency's tourism platform. Beyond code, I lead Event Activation at OmahTI UGM, running 13 programs in one term, coordinating across HR, PR, design, and all 8 technical divisions. My goal is to grow into an engineer who builds products that are user-centered and secure by design. Currently open to internships in software engineering, web development, and cybersecurity."}</p>
        <Link href="/about" prefetch={false} className="home-section-link">
          More about me →
        </Link>
      </section>

      {/* ── Contact CTA (§6.7) ──────────────────────────────────────── */}
      <section className="home-contact" aria-labelledby="home-contact-title">
        <h2 id="home-contact-title" className="home-section-title">
          Get in touch
        </h2>
        <p className="home-bio__text">{"maulfawriz@gmail.com"}</p>
        <Link href="/contact" prefetch={false} className="neo-pixel-btn">
          Contact
        </Link>
      </section>
    </div>
  );
}
