interface SocialLink {
  href: string;
  label: string;
  icon: React.ReactNode;
}

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

const SOCIAL_LINKS: SocialLink[] = [
  { href: "https://github.com/MaulanaFarisA", label: "GitHub", icon: <GitHubIcon /> },
  { href: "https://www.linkedin.com/in/maulanafaris", label: "LinkedIn", icon: <LinkedInIcon /> },
  { href: "https://www.instagram.com/maulanafariiss", label: "Instagram", icon: <InstagramIcon /> },
];

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="site-footer">
      <div className="site-footer__links">
        <a className="site-footer__link" href="mailto:maulfawriz@gmail.com">
          {"maulfawriz@gmail.com"}
        </a>

        {SOCIAL_LINKS.map(({ href, label, icon }) => (
          <a
            key={label}
            className="site-footer__link site-footer__icon-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${label} (opens in a new tab)`}
          >
            <span className="site-footer__icon">{icon}</span>
            <span className="external-cue" aria-hidden="true">
              {"\u2197"}
            </span>
          </a>
        ))}
      </div>

      <p className="site-footer__copyright">
        {`© ${year} Maulana Faris Al Ghifari`}
      </p>
    </footer>
  );
}
