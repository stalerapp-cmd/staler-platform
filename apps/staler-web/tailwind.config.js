/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        sunk: v('sunk'),
        ink: v('ink'),
        muted: v('muted'),
        line: v('line'),
        stitch: v('stitch'),
        olive: v('olive'),
        gold: v('gold'),
        night: v('night'),
        sky: v('sky'),
      },
      fontFamily: {
        display: ['"Reem Kufi"', '"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
        body: ['"IBM Plex Sans Arabic"', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl: '14px', '2xl': '20px', '3xl': '28px' },
      boxShadow: {
        lift: '0 1px 0 rgb(var(--line) / 0.6), 0 12px 32px -18px rgb(var(--night) / 0.45)',
        card: '0 30px 60px -30px rgb(var(--night) / 0.55)',
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-400px 0' }, '100%': { backgroundPosition: '400px 0' } },
      },
      animation: { shimmer: 'shimmer 1.4s linear infinite' },
    },
  },
  plugins: [],
};
