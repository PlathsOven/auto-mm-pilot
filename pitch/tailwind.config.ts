import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./terminal/**/*.{ts,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        accent: "var(--accent)",
        "accent-foreground": "var(--accent-foreground)",
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
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
        sans: ['"Inter"', '"Public Sans"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
