import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}', './extension/**/*.{ts,tsx,js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['Lora', 'serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto'],
      },
      colors: {
        // Figma palette - flattened for Tailwind v4
        'fn-bg': '#EBEBE9',
        'fn-card': '#FFFFFF',
        'fn-ink': '#000000',
        'fn-sub': '#707070',
        'fn-yellow': '#FFC413',
        'fn-green': '#369929',
        'fn-line': '#E0E0E0',
        'fn-lineMuted': '#DADAD8',
        'fn-overlay': 'rgba(0,0,0,0.6)',
        'fn-overlayLight': 'rgba(0,0,0,0.2)',
      },
      borderRadius: {
        mdx: '10px',
        lgx: '12px',
        xlx: '14px',
        card: '12px',
        sheet: '12px',
        tile: '8px',
      },
      boxShadow: {
        card: '0 6px 18px rgba(0,0,0,0.08)',
      },
    },
  },
  plugins: [],
} satisfies Config;
