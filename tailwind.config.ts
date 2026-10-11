import type { Config } from "tailwindcss";

export default {
  content: [
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--surface-canvas)",
        panel: "var(--surface-panel)",
        elevated: "var(--surface-elevated)",
        sunken: "var(--surface-sunken)",
        border: {
          DEFAULT: "var(--border-default)",
          strong: "var(--border-strong)",
        },
        ink: {
          DEFAULT: "var(--text-primary)",
          soft: "var(--text-secondary)",
          muted: "var(--text-muted)",
        },
        accent: {
          amber: "var(--accent-amber)",
          green: "var(--accent-green)",
          cyan: "var(--accent-cyan)",
          red: "var(--accent-red)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
        pixel: ["var(--font-pixel)"],
      },
      boxShadow: {
        pixel: "3px 3px 0 0 var(--border-strong)",
        "pixel-hover": "4px 4px 0 0 var(--border-strong)",
        "pixel-active": "1px 1px 0 0 var(--border-strong)",
      },
    },
  },
  plugins: [],
} satisfies Config;
