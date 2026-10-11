'use client';

import { startTransition, useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

export default function ThemeToggle() {
  // null until mounted. The inline §2.5 script sets data-theme on <html> before
  // React hydrates; reading it during the first client render would produce
  // markup that differs from SSR (React 19 hydration error #418 -> full client
  // re-render wipes the imperatively-set attribute). First pass is theme-neutral.
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    // Sync with what the inline script already set (default dark).
    const current = document.documentElement.dataset.theme;
    setTheme(current === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    // 1. Do the visible work synchronously: the attribute swap is what the user
    //    sees, and the stylesheet reacts to it immediately.
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
    // 2. Defer the React re-render. Calling setTheme() directly here scheduled
    //    reconciliation inside the click task, which dominated the INP budget
    //    under CPU throttling; a transition moves it out of the interaction.
    startTransition(() => setTheme(next));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={theme === 'light' ? 'Toggle theme: LIGHT' : theme === 'dark' ? 'Toggle theme: DARK' : 'Toggle theme'}
      aria-pressed={theme === 'light'}
      onClick={toggle}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '4px 10px',
        background: 'transparent',
        border: '1px solid var(--border-default)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '11px',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        cursor: 'pointer',
        lineHeight: 1.3,
      }}
    >
      {/* Tiny inline pixel icon — sun/moon as 8x8 grid */}
      <svg
        width="16"
        height="16"
        viewBox="0 0 8 8"
        fill="currentColor"
        aria-hidden="true"
        style={{ shapeRendering: 'crispEdges' }}
      >
        {theme === 'dark' ? (
          /* Moon: 8x8 pixel art */
          <path d="M3 0h2v1H3zM1 1h2v1H1zM0 2h1v4H0zM1 6h2v1H1zM3 7h2v1H3zM5 6h1v1H5zM5 1h1v1H5zM6 2h1v2H6z" />
        ) : (
          /* Sun: 8x8 pixel art */
          <path d="M3 0h2v1H3zM0 3h1v2H0zM7 3h1v2H7zM3 7h2v1H3zM1 1h1v1H1zM6 1h1v1H6zM1 6h1v1H1zM6 6h1v1H6zM2 2h4v1H2zM2 5h4v1H2zM2 2h1v4H2zM5 2h1v4H5z" />
        )}
      </svg>
      {/* Label renders only after mount so SSR and client-first-pass match. */}
      {/* aria-live keeps the state change announced without forcing the label
          to re-render inside the click task. */}
      <span className="theme-toggle__label" aria-live="polite">
        {theme === null ? '' : theme === 'dark' ? 'DARK' : 'LIGHT'}
      </span>
    </button>
  );
}
