import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "mm-bg": "#0f0f12",
        "mm-bg-deep": "#09090b",
        "mm-surface": "#18181b",
        "mm-border": "#27272a",
        "mm-accent": "#818cf8",
        "mm-text": "#fafafa",
        "mm-text-dim": "#a1a1aa",
        "mm-warn": "#fbbf24",
        "mm-error": "#f87171",
      },
      fontFamily: {
        sans: ['"Inter"', '"Public Sans"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
