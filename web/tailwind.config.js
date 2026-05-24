/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f1f7f4',
          100: '#dcebe2',
          200: '#b9d7c6',
          300: '#8fbda5',
          400: '#5e9c80',
          500: '#3f7d62',
          600: '#2f634d',
          700: '#264f3e',
          800: '#1f4032',
          900: '#173024',
        },
        arena: {
          live: '#facc15',
          liveDark: '#a16207',
          finished: '#22c55e',
          finishedDark: '#15803d',
          upcoming: '#64748b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 4px 24px -8px rgba(15, 23, 42, 0.18)',
        card: '0 10px 30px -12px rgba(15, 23, 42, 0.25)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
    },
  },
  plugins: [],
};
