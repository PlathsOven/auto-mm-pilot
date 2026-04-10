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
    },
  },
  plugins: [],
};

export default config;
