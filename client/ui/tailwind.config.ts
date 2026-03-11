import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "mm-bg": "#0D1117",
        "mm-bg-deep": "#0B0E14",
        "mm-surface": "#161B22",
        "mm-border": "#30363D",
        "mm-accent": "#58A6FF",
        "mm-text": "#C9D1D9",
        "mm-text-dim": "#8B949E",
        "mm-warn": "#D29922",
        "mm-error": "#F85149",
      },
      fontFamily: {
        sans: ['"Inter"', '"Public Sans"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
