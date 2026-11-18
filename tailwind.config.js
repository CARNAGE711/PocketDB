/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // PocketDB dark studio palette
        ink: {
          950: '#0b0f14',
          900: '#0e141b',
          850: '#121a23',
          800: '#16202b',
          700: '#1e2b38',
          600: '#2a3b4d',
        },
        brand: {
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
