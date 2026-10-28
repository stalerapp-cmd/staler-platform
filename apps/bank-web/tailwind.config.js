/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'), surface: v('surface'), sunk: v('sunk'), ink: v('ink'), muted: v('muted'), line: v('line'),
        stitch: v('ruby'), olive: v('sage'), gold: v('brass'), night: v('vault'), sky: v('sky'),
      },
      fontFamily: {
        display: ['Amiri', '"IBM Plex Sans Arabic"', 'Georgia', 'serif'],
        body: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '12px', '2xl': '16px', '3xl': '24px' },
      boxShadow: {
        lift: '0 1px 0 rgb(var(--line) / 0.6), 0 14px 34px -20px rgb(0 0 0 / 0.55)',
        card: '0 40px 70px -35px rgb(0 0 0 / 0.75)',
      },
      keyframes: { shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } } },
      animation: { shimmer: 'shimmer 1.4s linear infinite' },
    },
  },
  plugins: [],
};
