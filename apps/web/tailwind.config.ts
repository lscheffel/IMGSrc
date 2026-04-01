import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#111827',
        mint: '#22c55e',
        paper: '#f9fafb'
      }
    }
  },
  plugins: []
} satisfies Config;

