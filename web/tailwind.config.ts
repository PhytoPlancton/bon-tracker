import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#0b0c0e',
          soft: '#14161a',
          line: '#23272e',
        },
        accent: {
          DEFAULT: '#ff6e14',
          soft: '#ff8f45',
        },
        up: '#ef4444',
        down: '#22c55e',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
