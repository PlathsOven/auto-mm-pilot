import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* ── Light glassmorphism palette ── */
        "mm-bg": "#f4f4f7",
        "mm-bg-deep": "#eaeaef",
        "mm-surface": "rgba(255, 255, 255, 0.55)",
        "mm-surface-solid": "#ffffff",
        "mm-border": "rgba(255, 255, 255, 0.45)",
        "mm-border-outer": "rgba(0, 0, 0, 0.06)",
        "mm-accent": "#4f5bd5",
        "mm-accent-soft": "rgba(79, 91, 213, 0.10)",
        "mm-text": "#1a1a2e",
        "mm-text-dim": "#6e6e82",
        "mm-text-subtle": "#a0a0b2",
        "mm-positive": "#4f5bd5",
        "mm-negative": "#d4405c",
        "mm-neutral": "#a0a0b2",
        "mm-warn": "#c48a12",
        "mm-error": "#d4405c",
      },
      fontFamily: {
        sans: ['"Inter"', '"Public Sans"', "system-ui", "sans-serif"],
      },
      fontSize: {
        // Tighter end of the type scale for the trader-density UI. The
        // browser default 16px is twice what most surfaces want.
        xxs: ["9px", { lineHeight: "12px" }],
        xs2: ["10px", { lineHeight: "14px" }],
      },
      boxShadow: {
        // Subtle elevation scale — used by glass surfaces. Keep stops short
        // (3 levels) so the visual language stays disciplined.
        "elev-1": "0 1px 2px rgba(0, 0, 0, 0.04)",
        "elev-2": "0 4px 12px -4px rgba(15, 17, 41, 0.10), 0 1px 2px rgba(15, 17, 41, 0.04)",
        "elev-3": "0 12px 32px -8px rgba(15, 17, 41, 0.16), 0 4px 8px -2px rgba(15, 17, 41, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
