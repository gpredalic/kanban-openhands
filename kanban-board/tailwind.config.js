/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  // Scope every generated utility under the extension root so the bundle never
  // restyles the host application. `important` prepends the selector, turning
  // `.rounded-2xl` into `#kanban-extension-root .rounded-2xl`.
  important: "#kanban-extension-root",
  corePlugins: {
    // Preflight is a global CSS reset (html/body/button/input/h1-h6/ul/ol/a/img).
    // Disabling it stops the extension from altering host element defaults.
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        bg: {
          900: "#0f172a",
          800: "#111827",
          700: "#1e293b",
        },
        accent: {
          blue: "#3b82f6",
          indigo: "#6366f1",
          violet: "#8b5cf6",
        },
        status: {
          todo: "#64748b",
          progress: "#3b82f6",
          review: "#f59e0b",
          done: "#22c55e",
        },
        priority: {
          low: "#22c55e",
          medium: "#f59e0b",
          high: "#ef4444",
        },
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
        "glass-sm": "0 2px 12px 0 rgba(0, 0, 0, 0.25)",
        glow: "0 0 24px 0 rgba(99, 102, 241, 0.35)",
        "glow-blue": "0 0 24px 0 rgba(59, 130, 246, 0.4)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in-scale": {
          "0%": { opacity: "0", transform: "scale(0.97)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "blob-float": {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(20px, -30px) scale(1.08)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out both",
        "fade-in-scale": "fade-in-scale 0.2s ease-out both",
        "blob-float": "blob-float 14s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
      },
    },
  },
  plugins: [],
};
