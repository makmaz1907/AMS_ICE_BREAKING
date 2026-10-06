import type { Config } from "tailwindcss";

// NTT DATA brand palette and type (NTT DATA Brand Cheat Sheet). Noto Sans/Serif fall back to Arial/Georgia, as the brand guide allows.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#070F26",
        future: { DEFAULT: "#0072BC", 150: "#005B96", 50: "#19A3FC" },
        turquoise: "#00DFED",
        "brand-green": "#00CB5D",
        "brand-yellow": "#FFC400",
        "brand-orange": "#FF7A00",
        "brand-red": "#E42600",
        "text-grey": "#2E404D",
        "grey-50": "#E8E8E8",
      },
      fontFamily: {
        sans: ["Noto Sans", "Arial", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["Noto Serif", "Georgia", "ui-serif", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
