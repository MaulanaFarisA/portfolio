import type { Metadata } from "next";
import { ProjectGrid } from "@/components/ProjectGrid";
import { StoryPanel } from "@/components/StoryPanel";
import { StoryPanelMotion } from "@/components/StoryPanelMotion";
import { ogImage } from "@/components/JsonLd";
import { projects } from "@/content/projects";

/** §8.2 Work index meta — title/description/canonical/OG/og:locale. */
export const metadata: Metadata = {
  title: "Work - Maulana Faris",
  description: "Computer Science student at UGM, building web products end-to-end.",
  alternates: { canonical: "https://maulana.app/work" },
  openGraph: {
    title: "Work - Maulana Faris",
    description: "Computer Science student at UGM, building web products end-to-end.",
    url: "https://maulana.app/work",
    locale: "en_US",
    type: "website",
    images: [{ url: ogImage(), width: 1200, height: 630 }],
  },
};

/**
 * Work index (§5.4, §8.2). All projects, featured first; the grid layout
 * follows the §5.4 count rules (0 → empty state, 1–2 → full-width,
 * 3–4 → 2x2 with no stretched orphan, 5+ → featured row + list).
 */
export default function Work() {
  const ordered = [
    ...projects.filter((project) => project.featured),
    ...projects.filter((project) => !project.featured),
  ];

  return (
    <div className="work">
      <header className="page-head">
        <h1 className="page-title">Work</h1>
      </header>
      <ProjectGrid projects={ordered} />

      {/* Story panel: step inside — the workbench where the projects get built. */}
      <StoryPanelMotion />
      <StoryPanel
        scene="workbench"
        label="Inside the workshop"
        caption="Every project starts here: one screen, one print of the machine that gets me there, and a desk that never stays tidy."
      />
    </div>
  );
}
