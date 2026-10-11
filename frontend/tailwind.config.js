/** @type {import('tailwindcss').Config} */

// Design tokens come from the UI UX Pro Max "Real-Time / Operations" design system
// (Glassmorphism, dark tech + status green, Fira Code / Fira Sans). Values live as
// RGB channels in src/index.css so opacity modifiers like bg-card/70 work.
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: token('bg'),
        card: token('card'),
        muted: token('muted'),
        'muted-fg': token('muted-fg'),
        line: token('border'),
        fg: token('fg'),
        neon: token('accent'),
        electric: token('electric'),
        danger: token('danger'),
      },
      fontFamily: {
        sans: ['"Fira Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"Fira Code"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        neon: '0 0 18px rgb(var(--c-accent) / 0.30)',
        electric: '0 0 18px rgb(var(--c-electric) / 0.30)',
      },
      keyframes: {
        'card-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'card-in': 'card-in 250ms ease-out',
      },
    },
  },
  plugins: [],
};
