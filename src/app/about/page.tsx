import type { Metadata } from "next";
import { Divider } from "@/components/Divider";
import { JsonLd, ogImage, personJsonLd } from "@/components/JsonLd";
import { StatusBadge } from "@/components/StatusBadge";
import { WindowCard } from "@/components/WindowCard";
import { StoryPanel } from "@/components/StoryPanel";
import { StoryPanelMotion } from "@/components/StoryPanelMotion";

/** §8.2 About meta + §8.3 Person JSON-LD. */
export const metadata: Metadata = {
  title: "About Maulana Faris Al Ghifari - UGM Computer Science",
  description: "About Maulana Faris Al Ghifari - Computer Science student at UGM, intern at Kominfo Kulon Progo and Dinas Pariwisata Kulon Progo.",
  alternates: { canonical: "https://maulana.app/about" },
  openGraph: {
    title: "About Maulana Faris Al Ghifari - UGM Computer Science",
    description: "About Maulana Faris Al Ghifari - Computer Science student at UGM, intern at Kominfo Kulon Progo and Dinas Pariwisata Kulon Progo.",
    url: "https://maulana.app/about",
    locale: "en_US",
    type: "website",
    images: [{ url: ogImage(), width: 1200, height: 630 }],
  },
};

/**
 * About page (§6.5).
 *
 * Structure: avatar image + bio (single paragraph) + skill grid + timeline.
 *
 * Skill chips are non-interactive text (no fake links). The timeline is a
 * semantic `<ol>` (§6.5 accessibility).
 */
const skills = [
  "Web Development",
  "TypeScript",
  "React",
  "Next.js",
  "Tailwind CSS",
  "Supabase",
  "Cybersecurity",
  "Git",
] as const;

const timeline = [
  {
    year: "2024",
    text: "Started Computer Science at UGM. Won Data Royale DIKE 2024: 1st place (Round 1) and 2nd place overall.",
  },
  {
    year: "2025",
    text: "Joined OmahTI UGM. Sub-coordinator of OmahTI Academy; co-built the Jemparingan QR scoring system.",
  },
  {
    year: "2026",
    text: "Bakti BCA 2026 awardee. Built core sections of the APECX 2026 platform; led Event Activation across 13 programs.",
  },
  {
    year: "NOW",
    text: "Interning at Kominfo Kulon Progo and Dinas Pariwisata Kulon Progo, leading the Pesona Kulon Progo platform team. Open to internships.",
  },
] as const;

export default function About() {
  return (
    <div className="about">
      <JsonLd data={personJsonLd("https://maulana.app/about")} />
      <header className="page-head">
        <p className="page-kicker">{"Web Developer"}</p>
        <h1 className="page-title">About</h1>
      </header>

      {/* ── Avatar + bio (§6.5) ─────────────────────────────────────── */}
      <section className="about-intro" aria-labelledby="about-intro-title">
        <div
          className="about-avatar dither-surface"
          data-testid="about-avatar"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/avatar.jpg" alt="Portrait of Maulana Faris Al Ghifari" />
        </div>

        <WindowCard title="Bio" className="about-bio-card">
          <h2 id="about-intro-title" className="about-bio-card__title">
            {"Maulana Faris Al Ghifari"}
          </h2>
          <p className="about-bio__text" data-testid="about-bio">
            {"I'm a Computer Science student at Universitas Gadjah Mada, Yogyakarta, building web products end-to-end and learning how to break them, too. I'm a Bakti BCA 2026 scholarship awardee, selected from 700 students across 20 universities. Over the past two years I've shipped production platforms: Buku Tahu, a bookkeeping app for tofu SMEs, and the Jemparingan QR scoring system, both live. I built core sections of the APECX 2026 platform and co-authored two cybersecurity training modules for IndoCEISS. As an intern at Kominfo Kulon Progo and Dinas Pariwisata Kulon Progo, I'm leading a 6-person team rebuilding the regency's tourism platform. Beyond code, I lead Event Activation at OmahTI UGM, running 13 programs in one term, coordinating across HR, PR, design, and all 8 technical divisions. My goal is to grow into an engineer who builds products that are user-centered and secure by design. Currently open to internships in software engineering, web development, and cybersecurity."}
          </p>
        </WindowCard>
      </section>

      <Divider variant="dither" className="about-divider" />

      {/* ── Skill grid — non-interactive text chips ─────────────────── */}
      <section className="about-skills" aria-labelledby="about-skills-title">
        <h2 id="about-skills-title" className="home-section-title">
          Skills
        </h2>
        <ul className="about-skill-grid" data-testid="about-skill-grid">
          {skills.map((skill) => (
            <li key={skill} className="about-skill-chip">
              {skill}
            </li>
          ))}
        </ul>
      </section>

      <Divider variant="dither" className="about-divider" />

      {/* ── Timeline — semantic <ol> (§6.5) ─────────────────────────── */}
      <section className="about-timeline" aria-labelledby="about-timeline-title">
        <h2 id="about-timeline-title" className="home-section-title">
          Timeline
        </h2>
        <ol className="about-timeline__list" data-testid="about-timeline">
          {timeline.map((entry) => (
            <li key={entry.year} className="about-timeline__item">
              <span className="about-timeline__year">{entry.year}</span>
              <span className="about-timeline__text">{entry.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <Divider variant="dither" className="about-divider" />

      {/* Story panel: the terminal — where the work actually happens. */}
      <StoryPanelMotion />
      <StoryPanel
        scene="terminal"
        label="Where it happens"
        caption="The CRT is the last room in the sequence: past the front door, past the desk, down to the machine that turns an idea into something that runs."
      />

      {/* ── Status footnote ─────────────────────────────────────────── */}
      <section className="about-status" aria-label="Status">
        <StatusBadge status="online" label="OPEN TO INTERNSHIPS" />
      </section>
    </div>
  );
}
