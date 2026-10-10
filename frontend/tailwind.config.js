/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        neon: '#39ff88',
        electric: '#22d3ee',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        neon: '0 0 18px rgba(57, 255, 136, 0.35)',
        electric: '0 0 18px rgba(34, 211, 238, 0.35)',
      },
      keyframes: {
        'card-in': {
          from: { opacity: '0', transform: 'translateY(-6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'card-in': 'card-in 300ms ease-out',
      },
    },
  },
  plugins: [],
};
