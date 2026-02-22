/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        ab: '#f97316',
        abb: '#2563eb',
        sbb: '#16a34a',
        pbc: '#7c3aed',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
