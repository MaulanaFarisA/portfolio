'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { PixelLogo } from './PixelLogo';
import ThemeToggle from './ThemeToggle';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/work', label: 'Work' },
  { href: '/about', label: 'About' },
  { href: '/stack', label: 'Stack' },
  { href: '/contact', label: 'Contact' },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // §7.2: IntersectionObserver instead of scroll listener
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setScrolled(!entry.isIntersecting);
      },
      { threshold: 0 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // Close panel on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Escape key closes panel and returns focus to hamburger
  useEffect(() => {
    if (!menuOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        hamburgerRef.current?.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  const toggleMenu = useCallback(() => {
    setMenuOpen((prev) => !prev);
  }, []);

  return (
    <>
      {/* Top sentinel for IntersectionObserver scroll detection */}
      <div ref={sentinelRef} className="site-nav-sentinel" aria-hidden="true" />

      <header
        className={`site-nav${scrolled ? ' site-nav--scrolled' : ''}${menuOpen ? ' site-nav--panel-open' : ''}`}
      >
        {/* Skip-to-content link — first focusable element */}
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <nav aria-label="Primary" className="site-nav__inner">
          {/* Brand */}
          <Link href="/" className="site-nav__brand" aria-label="Home">
            <PixelLogo label="Logo" size={24} />
          </Link>

          {/* Desktop links — prefetch={false}: the header sits above the fold on
              every route, so Next's viewport-triggered prefetch fires one RSC
              request per nav destination (≈10 KB each) during the critical
              initial load, competing for the throttled mobile connection and
              delaying the LCP element's render (same rationale as ProjectCard).
              Client-side nav still fetches on click, so navigation stays instant. */}
          <ul className="site-nav__links">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={false}
                  className={`site-nav__link${pathname === href ? ' site-nav__link--active' : ''}`}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>

          {/* Right side: theme toggle + CTA + hamburger */}
          <div className="site-nav__actions">
            <ThemeToggle />
            {/* CTA renders the anchor AS the button (§6.8 styles) — never <a><button> */}
            <Link
              href="/contact"
              className="site-nav__cta-link neo-pixel-btn neo-pixel-btn--sm"
            >
              HIRE ME
            </Link>

            {/* Mobile hamburger */}
            <button
              ref={hamburgerRef}
              type="button"
              className="site-nav__hamburger"
              aria-expanded={menuOpen}
              aria-controls="mobile-nav-panel"
              aria-label="Menu"
              onClick={toggleMenu}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
                style={{ shapeRendering: 'crispEdges' }}
              >
                {menuOpen ? (
                  /* X icon */
                  <path d="M4 4h2v2H4zM6 6h2v2H6zM8 8h4v2H8zM12 6h2v2h-2zM14 4h2v2h-2zM4 14h2v2H4zM6 12h2v2H6zM12 12h2v2h-2zM14 14h2v2h-2z" />
                ) : (
                  /* Hamburger lines */
                  <path d="M2 4h16v2H2zM2 9h16v2H2zM2 14h16v2H2z" />
                )}
              </svg>
            </button>
          </div>
        </nav>

        {/* Mobile panel — inert while closed so its links are never tabbable */}
        <div
          id="mobile-nav-panel"
          className={`site-nav__panel${menuOpen ? ' site-nav__panel--open' : ''}`}
          role="region"
          aria-label="Mobile navigation"
          inert={!menuOpen}
        >
          <ul className="site-nav__panel-links">
            {NAV_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={false}
                  className={`site-nav__link${pathname === href ? ' site-nav__link--active' : ''}`}
                  onClick={() => setMenuOpen(false)}
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <div className="site-nav__panel-cta">
            <Link
              href="/contact"
              className="neo-pixel-btn"
              onClick={() => setMenuOpen(false)}
            >
              HIRE ME
            </Link>
          </div>
        </div>
      </header>
    </>
  );
}
