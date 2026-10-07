/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Premium dark cybersecurity palette
        base: {
          950: "#07090c",
          900: "#0b0e13",
          850: "#0f131a",
          800: "#141922",
          700: "#1c222e",
          600: "#272f3e",
        },
        accent: {
          DEFAULT: "#10b981",
          soft: "#34d399",
          cyan: "#22d3ee",
        },
        danger: "#f43f5e",
        warn: "#f59e0b",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(255,255,255,0.04), 0 12px 40px -12px rgba(0,0,0,0.8)",
        glow: "0 0 24px -6px rgba(16,185,129,0.35)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.35s ease-out both",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
