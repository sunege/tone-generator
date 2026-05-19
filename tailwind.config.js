/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        lab: {
          bg: '#f6f9fc',
          surface: '#ffffff',
          accent: '#0ea5e9',
          accent2: '#f97316',
          ink: '#0f172a',
          mute: '#64748b',
          line: '#cbd5e1',
        },
      },
      fontFamily: {
        sans: ['"Hiragino Sans"', '"Yu Gothic"', 'Meiryo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
