import type { Metadata } from "next";
import { CopyEmailButton } from "@/components/CopyEmailButton";
import { ogImage } from "@/components/JsonLd";

/** §8.2 Contact meta — title/description/canonical/OG/og:locale. */
export const metadata: Metadata = {
  title: "Contact - Maulana Faris",
  description: "Get in touch - email, social links, and resume download.",
  alternates: { canonical: "https://maulana.app/contact" },
  openGraph: {
    title: "Contact - Maulana Faris",
    description: "Get in touch - email, social links, and resume download.",
    url: "https://maulana.app/contact",
    locale: "en_US",
    type: "website",
    images: [{ url: ogImage(), width: 1200, height: 630 }],
  },
};

function GitHubIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="2" width="2" height="2" />
      <rect x="11" y="2" width="2" height="2" />
      <rect x="2" y="4" width="12" height="2" />
      <rect x="2" y="6" width="12" height="3" />
      <rect x="3" y="9" width="10" height="2" />
      <rect x="4" y="11" width="8" height="1" />
      <rect x="5" y="6" width="2" height="2" fill="var(--surface-canvas)" />
      <rect x="9" y="6" width="2" height="2" fill="var(--surface-canvas)" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="3" y="2" width="3" height="3" />
      <rect x="3" y="7" width="3" height="7" />
      <rect x="8" y="7" width="2" height="7" />
      <rect x="10" y="7" width="3" height="2" />
      <rect x="11" y="9" width="2" height="5" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="1" width="8" height="2" />
      <rect x="2" y="2" width="2" height="2" />
      <rect x="12" y="2" width="2" height="2" />
      <rect x="1" y="4" width="2" height="8" />
      <rect x="13" y="4" width="2" height="8" />
      <rect x="2" y="12" width="2" height="2" />
      <rect x="12" y="12" width="2" height="2" />
      <rect x="4" y="13" width="8" height="2" />
      <rect x="6" y="6" width="4" height="1" />
      <rect x="5" y="7" width="1" height="4" />
      <rect x="10" y="7" width="1" height="4" />
      <rect x="6" y="11" width="4" height="1" />
      <rect x="10" y="4" width="2" height="2" />
    </svg>
  );
}

const SOCIALS = [
  { label: "GitHub", href: "https://github.com/MaulanaFarisA", icon: <GitHubIcon /> },
  { label: "LinkedIn", href: "https://www.linkedin.com/in/maulanafaris", icon: <LinkedInIcon /> },
  { label: "Instagram", href: "https://www.instagram.com/maulanafariiss", icon: <InstagramIcon /> },
];

export default function ContactPage() {
  return (
    <div className="contact">
      <header className="page-head">
        <p className="page-kicker">GET IN TOUCH</p>
        <h1 className="page-title">Contact</h1>
      </header>

      <div className="contact-body">
        <p className="contact-intro">
          Direct line is open. Email, copy the address, or find me on the grid.
        </p>

        <div className="contact-row">
          <span className="contact-label">EMAIL</span>
          <div className="contact-email-group">
            <a className="contact-email" href="mailto:maulfawriz@gmail.com">
              {"maulfawriz@gmail.com"}
            </a>
            <CopyEmailButton />
          </div>
        </div>

        <div className="contact-row">
          <span className="contact-label">SOCIAL</span>
          <ul className="contact-socials">
            {SOCIALS.map(({ label, href, icon }) => (
              <li key={label}>
                <a
                  className="contact-social"
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${label} (opens in a new tab)`}
                >
                  <span className="contact-icon">{icon}</span>
                  <span className="external-cue" aria-hidden="true">
                    {"\u2197"}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>

        <div className="contact-row">
          <span className="contact-label">RESUME</span>
          <a
            className="neo-pixel-btn neo-pixel-btn--sm contact-resume"
            href="/resume.pdf"
            download
          >
            RESUME.PDF
          </a>
        </div>
      </div>
    </div>
  );
}
